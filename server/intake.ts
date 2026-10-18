import {DB} from './db.js';
import {lockRules,routeLead} from './lead-service.js';
/** Creates company, contact and lead for an unknown sender and routes the lead. Used by inbound channels. */
export async function captureLead(db:DB,ws:string,i:{name:string;phone?:string;email?:string;company?:string;source:'Website'|'WhatsApp'|'Manual'|'Referral'}){
 const owner=(await db.query("SELECT id FROM memberships WHERE workspace_id=$1 AND base_level='Owner' AND active",[ws])).rows[0];if(!owner)throw new Error('Workspace has no active owner.');
 const rules=await lockRules(db,ws);
 const company=(await db.query('INSERT INTO companies(workspace_id,name,owner_id) VALUES($1,$2,$3) RETURNING id',[ws,i.company||i.name,owner.id])).rows[0];
 const contact=(await db.query('INSERT INTO contacts(workspace_id,company_id,owner_id,name,email,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[ws,company.id,owner.id,i.name,i.email||null,i.phone||null])).rows[0];
 const lead=(await db.query('INSERT INTO leads(workspace_id,contact_id,source,accountable_member_id,waiting_for_assignment) VALUES($1,$2,$3,$4,true) RETURNING *',[ws,contact.id,i.source,owner.id])).rows[0];
 await routeLead(db,ws,lead,rules,'assigned',null);
 return {contactId:contact.id as string,leadId:lead.id as string};
}
export const addActivity=(db:DB,ws:string,contactId:string,actor:string|null,kind:string,body:string,opportunityId:string|null=null)=>db.query('INSERT INTO activities(workspace_id,contact_id,actor_id,kind,body,opportunity_id) VALUES($1,$2,$3,$4,$5,$6)',[ws,contactId,actor,kind,body,opportunityId]);
