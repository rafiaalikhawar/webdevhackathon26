import type {Request,Response} from 'express';
import {HttpException} from '@nestjs/common';
import {scoped} from './scope.js';
import {audit} from './db.js';

// Neutralise spreadsheet formula injection and quote CSV fields.
function cell(v:unknown):string{if(v===null||v===undefined)return '';let s=v instanceof Date?v.toISOString():String(v);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
const csv=(head:string[],rows:unknown[][])=>[head,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';

/** Server-side CSV export. Requires crm.export; honours record scope and masks opportunity value without opportunity.value. */
export async function exportCsv(req:Request,res:Response,kind:string){
 if(kind!=='contacts'&&kind!=='opportunities')throw new HttpException('Unknown export.',404);
 const body=await scoped(req,'crm.export',async(db,ctx)=>{
  const all=ctx.permissions.has('crm.view_all'),values=ctx.permissions.has('opportunity.value');
  let out:string,count:number;
  if(kind==='contacts'){
   const r=(await db.query(`SELECT c.name,c.email,c.phone,co.name AS company,u.name AS owner,c.opted_out,c.created_at FROM contacts c JOIN companies co ON co.id=c.company_id AND co.workspace_id=c.workspace_id LEFT JOIN memberships m ON m.id=c.owner_id AND m.workspace_id=c.workspace_id LEFT JOIN users u ON u.id=m.user_id WHERE c.workspace_id=$1 AND c.archived_at IS NULL AND ($2::boolean OR c.owner_id=$3) ORDER BY c.created_at DESC LIMIT 10000`,[ctx.workspaceId,all,ctx.memberId])).rows;
   count=r.length;out=csv(['Name','Email','Phone','Company','Owner','Opted out','Created'],r.map(x=>[x.name,x.email,x.phone,x.company,x.owner,x.opted_out,x.created_at]));
  }else{
   const r=(await db.query(`SELECT o.name,c.name AS contact,p.name AS pipeline,s.name AS stage,u.name AS owner,o.value_minor,o.currency,o.close_date FROM opportunities o JOIN contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id JOIN pipelines p ON p.id=o.pipeline_id AND p.workspace_id=o.workspace_id JOIN stages s ON s.id=o.stage_id AND s.workspace_id=o.workspace_id LEFT JOIN memberships m ON m.id=o.owner_id AND m.workspace_id=o.workspace_id LEFT JOIN users u ON u.id=m.user_id WHERE o.workspace_id=$1 AND o.archived_at IS NULL AND ($2::boolean OR o.owner_id=$3) ORDER BY o.name LIMIT 10000`,[ctx.workspaceId,all,ctx.memberId])).rows;
   count=r.length;
   out=values?csv(['Name','Contact','Pipeline','Stage','Owner','Value','Currency','Close date'],r.map(x=>[x.name,x.contact,x.pipeline,x.stage,x.owner,(Number(x.value_minor)/100).toFixed(2),x.currency,x.close_date]))
    :csv(['Name','Contact','Pipeline','Stage','Owner','Close date'],r.map(x=>[x.name,x.contact,x.pipeline,x.stage,x.owner,x.close_date]));
  }
  await audit(db,ctx.workspaceId,ctx.memberId,'export.csv',null,null,{kind,rows:count,valuesIncluded:kind==='opportunities'?values:undefined});
  return out;
 });
 res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${kind}.csv"`);res.setHeader('Cache-Control','no-store');
 res.send(body);
}
