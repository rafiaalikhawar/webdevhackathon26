import {Controller,Get,Req,Res,Query} from '@nestjs/common';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {transaction} from './db.js';
import {context} from './auth.js';
/** Cheap per-workspace change fingerprint. Any lead, message, payment, activity, notification or audit change alters it. */
const FINGERPRINT=`SELECT md5(concat_ws('|',
 (SELECT count(*)||':'||COALESCE(max(created_at)::text,'') FROM audit_logs),
 (SELECT count(*) FROM messages),(SELECT count(*) FROM messages WHERE status IN ('delivered','failed')),
 (SELECT count(*) FROM activities),(SELECT count(*) FROM notifications),
 (SELECT COALESCE(sum(version),0) FROM leads),(SELECT COALESCE(sum(version),0) FROM opportunities),
 (SELECT count(*)||COALESCE(string_agg(status,''),'') FROM payments),(SELECT count(*) FROM appointments),
 (SELECT COALESCE(string_agg(availability,''),'') FROM memberships))) AS f`;
@Controller('api')
export class EventsController{
 /** Server-sent events: emits "change" when workspace data changes. The session cookie authenticates; workspace comes from ?ws=. */
 @Get('events')async stream(@Req()req:Request,@Res()res:Response,@Query('ws')ws:string){
  req.headers['x-workspace-id']=z.uuid().parse(ws);const ctx=await context(req);
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 3000\n\n');
  let last='',closed=false,busy=false;req.on('close',()=>{closed=true;clearInterval(timer)});
  const tick=async()=>{if(closed||busy)return;busy=true;try{const f=await transaction(ctx.workspaceId,async db=>(await db.query(FINGERPRINT)).rows[0].f as string);if(f!==last){if(last)res.write('event: change\ndata: {}\n\n');last=f;}else res.write(': keepalive\n\n');}catch{closed=true;res.end()}finally{busy=false}};
  const timer=setInterval(tick,2000);await tick();
 }
}
