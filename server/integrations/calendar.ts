import {Controller,Get,Post,Patch,Delete,Req,Res,Param,Query,HttpException} from '@nestjs/common';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {transaction,audit,DB} from '../db.js';
import {context} from '../auth.js';
import {requirePermission,requireRecord} from '../policy.js';
import {scoped} from '../scope.js';
import {addActivity} from '../intake.js';
import {acknowledgeOnAction} from '../lead-service.js';
import {credentials,saveIntegration,getIntegration,recordEvent,markResult,publicBase} from './registry.js';
import {signState,verifyState} from './secrets.js';
import {authUrl,exchangeCode,refresh,busyTimes,overlaps,createEvent,patchEvent,deleteEvent,Tokens} from './google.js';
import {http} from './manage.js';
/** Runs a transaction that may report a provider failure. The failure is thrown after commit so the failed-operation record is kept. */
async function inTx<T>(ws:string,fn:(db:DB)=>Promise<T|{failure:string}>):Promise<T>{const out=await transaction(ws,fn as (db:DB)=>Promise<unknown>);if(out&&typeof out==='object'&&'failure' in (out as object))throw new HttpException(String((out as {failure:string}).failure),502);return out as T;}
const uuid=z.uuid();
const redirectUri=()=>`${publicBase()}/api/oauth/google/callback`;
const tz=z.string().max(64).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true}catch{return false}},'Unknown time zone');
const nf=(m='Record not found.')=>new HttpException(m,404);

/** Returns a valid access token for the employee, refreshing when needed. Marks the connection as needing reconnection if Google revoked it. */
export async function freshToken(ws:string,memberId:string):Promise<{token:string;integrationId:string}>{
 const state=await transaction(ws,async db=>{const app=await credentials<{clientId:string;clientSecret:string}>(db,ws,'google');const mine=await credentials<Tokens>(db,ws,'google',memberId);return {app,mine};});
 if(!state.app)throw new HttpException('Google Calendar is not configured for this workspace. An Admin must add the Google OAuth credentials.',409);
 if(!state.mine||state.mine.status!=='connected')throw new HttpException('This employee has not connected a Google Calendar, or the connection needs to be reconnected.',409);
 const t=state.mine.secrets;if(t.expiresAt>Date.now()+60000)return {token:t.accessToken,integrationId:state.mine.id};
 if(!t.refreshToken)throw await needsReconnect(ws,memberId,'Google did not provide a refresh token. Reconnect your calendar.');
 const r=await refresh(http,{clientId:state.app.secrets.clientId,clientSecret:state.app.secrets.clientSecret,refreshToken:t.refreshToken});
 if(!r.ok){if(r.revoked)throw await needsReconnect(ws,memberId,r.reason);throw new HttpException(r.reason,502);}
 await transaction(ws,db=>saveIntegration(db,ws,'google',memberId,{...t,accessToken:r.accessToken,expiresAt:r.expiresAt},{}));
 return {token:r.accessToken,integrationId:state.mine.id};
}
async function needsReconnect(ws:string,memberId:string,reason:string){
 await transaction(ws,async db=>{const row=await getIntegration(db,ws,'google',memberId);if(row)await db.query("UPDATE integrations SET status='needs_reconnect',last_error=$3,last_error_at=now() WHERE id=$1 AND workspace_id=$2",[row.id,ws,reason]);});
 return new HttpException(reason,409);
}
async function lockAppointment(db:DB,ws:string,appointmentId:string){
 const a=(await db.query('SELECT * FROM appointments WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[uuid.parse(appointmentId),ws])).rows[0];if(!a)throw nf();return a;
}
@Controller('api')
export class CalendarController{
 @Get('calendar/connections')connections(@Req()req:Request){return scoped(req,'crm.view',async(db,ctx)=>{
  const admin=ctx.permissions.has('integration.manage');
  const rows=(await db.query("SELECT i.member_id,i.status,i.last_error,u.name FROM integrations i JOIN memberships m ON m.id=i.member_id AND m.workspace_id=i.workspace_id JOIN users u ON u.id=m.user_id WHERE i.workspace_id=$1 AND i.provider='google' AND i.member_id IS NOT NULL AND ($2::boolean OR i.member_id=$3)",[ctx.workspaceId,admin,ctx.memberId])).rows;
  const app=await getIntegration(db,ctx.workspaceId,'google');
  return {configured:!!app?.secrets_encrypted,connections:rows.map(r=>({memberId:r.member_id,name:r.name,status:r.status,error:r.last_error}))};});}
 @Get('oauth/google/start')start(@Req()req:Request){return scoped(req,'crm.view',async(db,ctx)=>{
  const app=await credentials<{clientId:string}>(db,ctx.workspaceId,'google');if(!app)throw new HttpException('An Admin must add Google OAuth credentials on the Integrations page first.',409);
  return {url:authUrl(app.secrets.clientId,redirectUri(),signState({ws:ctx.workspaceId,member:ctx.memberId}))};});}
 @Get('oauth/google/callback')async callback(@Res()res:Response,@Query('code')code?:string,@Query('state')state?:string,@Query('error')error?:string){
  const back=(q:string)=>res.redirect((process.env.APP_ORIGIN||'http://localhost:5173')+'/?'+q);
  if(error||!code||!state)return back('calendar=denied');
  const data=verifyState(state);if(!data)return back('calendar=invalid');
  const ws=uuid.parse(data.ws),member=uuid.parse(data.member);
  const app=await transaction(ws,db=>credentials<{clientId:string;clientSecret:string}>(db,ws,'google'));if(!app)return back('calendar=invalid');
  const r=await exchangeCode(http,{clientId:app.secrets.clientId,clientSecret:app.secrets.clientSecret,code,redirectUri:redirectUri()});
  await transaction(ws,async db=>{
   if(!r.ok){await recordEvent(db,ws,app.id,{direction:'out',type:'oauth.exchange',status:'failed',error:r.reason});return;}
   const prior=await credentials<Tokens>(db,ws,'google',member);
   await saveIntegration(db,ws,'google',member,{...r.tokens,refreshToken:r.tokens.refreshToken||prior?.secrets.refreshToken},{});
   await recordEvent(db,ws,app.id,{direction:'out',type:'oauth.exchange',summary:{member}});await audit(db,ws,member,'calendar.connected',member,null,{provider:'google'});
  });
  return back(r.ok?'calendar=connected':'calendar=failed');
 }
 @Delete('calendar/connection')disconnect(@Req()req:Request){return scoped(req,'crm.view',async(db,ctx)=>{await db.query("DELETE FROM integrations WHERE workspace_id=$1 AND provider='google' AND member_id=$2",[ctx.workspaceId,ctx.memberId]);await audit(db,ctx.workspaceId,ctx.memberId,'calendar.disconnected',ctx.memberId,null,null);return {ok:true};});}
 @Get('calendar/busy')async busy(@Req()req:Request,@Query('memberId')memberId:string,@Query('from')from:string,@Query('to')to:string){
  const ctx=await context(req);requirePermission(ctx,'crm.view');const m=uuid.parse(memberId||ctx.memberId);if(m!==ctx.memberId)requirePermission(ctx,'assignment.manage');
  const w=z.object({from:z.iso.datetime({offset:true}),to:z.iso.datetime({offset:true})}).parse({from,to});
  const {token}=await freshToken(ctx.workspaceId,m);const r=await busyTimes(http,token,w.from,w.to);if(!r.ok)throw new HttpException(r.reason,502);return {busy:r.busy};
 }
 @Post('appointments')async book(@Req()req:Request){
  const ctx=await context(req);requirePermission(ctx,'crm.edit');
  const f=z.object({contactId:uuid,employeeId:uuid.optional(),title:z.string().trim().min(1).max(200),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),timezone:tz,force:z.boolean().default(false)}).strict().parse(req.body);
  if(Date.parse(f.endsAt)<=Date.parse(f.startsAt))throw new HttpException('The appointment must end after it starts.',400);
  const employee=f.employeeId||ctx.memberId;if(employee!==ctx.memberId)requirePermission(ctx,'assignment.manage');
  const contact=await transaction(ctx.workspaceId,async db=>{const c=(await db.query('SELECT * FROM contacts WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL',[f.contactId,ctx.workspaceId])).rows[0];if(!c)throw nf();requireRecord(ctx,c.owner_id);return c;});
  const {token,integrationId}=await freshToken(ctx.workspaceId,employee);
  const b=await busyTimes(http,token,f.startsAt,f.endsAt);if(!b.ok)throw new HttpException(b.reason,502);
  const clash=overlaps(b.busy,f.startsAt,f.endsAt);
  if(clash.length&&!f.force)throw new HttpException(`This time overlaps ${clash.length} existing event${clash.length>1?'s':''} on the calendar. Choose another time or confirm to double-book.`,409);
  const e=await createEvent(http,token,{title:f.title,start:f.startsAt,end:f.endsAt,timezone:f.timezone,attendeeEmail:contact.email||undefined});
  return inTx(ctx.workspaceId,async db=>{
   if(!e.ok){await recordEvent(db,ctx.workspaceId,integrationId,{direction:'out',type:'event.create',status:'failed',error:e.reason});await markResult(db,integrationId,ctx.workspaceId,false,e.reason);return {failure:e.reason};}
   await acknowledgeOnAction(db,ctx,contact.id);
   const a=(await db.query("INSERT INTO appointments(workspace_id,contact_id,employee_id,title,starts_at,ends_at,timezone,provider_event_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'confirmed') RETURNING id",[ctx.workspaceId,contact.id,employee,f.title,f.startsAt,f.endsAt,f.timezone,e.id])).rows[0];
   await recordEvent(db,ctx.workspaceId,integrationId,{eventId:'out:'+e.id,direction:'out',type:'event.create',summary:{appointmentId:a.id}});await markResult(db,integrationId,ctx.workspaceId,true);
   await addActivity(db,ctx.workspaceId,contact.id,ctx.memberId,'appointment',`Appointment booked: ${f.title} (${f.startsAt}, ${f.timezone}).`);
   await db.query('UPDATE leads SET last_activity_at=now() WHERE workspace_id=$1 AND contact_id=$2',[ctx.workspaceId,contact.id]);
   await audit(db,ctx.workspaceId,ctx.memberId,'appointment.created',a.id,null,{startsAt:f.startsAt});
   return {id:a.id,googleEventId:e.id};
  });
 }
 @Patch('appointments/:id')async reschedule(@Req()req:Request,@Param('id')id:string){
  const ctx=await context(req);requirePermission(ctx,'crm.edit');
  const f=z.object({startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),timezone:tz.optional(),force:z.boolean().default(false)}).strict().parse(req.body);
  if(Date.parse(f.endsAt)<=Date.parse(f.startsAt))throw new HttpException('The appointment must end after it starts.',400);
  const a=await transaction(ctx.workspaceId,async db=>{const x=await lockAppointment(db,ctx.workspaceId,id);if(x.employee_id!==ctx.memberId)requirePermission(ctx,'assignment.manage');if(x.status==='cancelled')throw new HttpException('This appointment was cancelled.',409);return x;});
  const {token,integrationId}=await freshToken(ctx.workspaceId,a.employee_id);
  const busy=await busyTimes(http,token,f.startsAt,f.endsAt);if(!busy.ok)throw new HttpException(busy.reason,502);
  const sameSlot=(x:string)=>Math.abs(Date.parse(x)-new Date(a.starts_at).getTime())<1000||Math.abs(Date.parse(x)-new Date(a.ends_at).getTime())<1000;
  const clash=overlaps(busy.busy.filter((x:{start:string;end:string})=>!(sameSlot(x.start)&&sameSlot(x.end))),f.startsAt,f.endsAt);
  if(clash.length&&!f.force)throw new HttpException(`This time overlaps ${clash.length} existing event${clash.length>1?'s':''} on the calendar. Choose another time or confirm to double-book.`,409);
  const r=await patchEvent(http,token,a.provider_event_id,{start:f.startsAt,end:f.endsAt,timezone:f.timezone||a.timezone});
  return inTx(ctx.workspaceId,async db=>{
   if(!r.ok){await recordEvent(db,ctx.workspaceId,integrationId,{direction:'out',type:'event.update',status:'failed',error:r.reason});await markResult(db,integrationId,ctx.workspaceId,false,r.reason);return {failure:r.reason};}
   await db.query('UPDATE appointments SET starts_at=$3,ends_at=$4,timezone=$5 WHERE id=$1 AND workspace_id=$2',[a.id,ctx.workspaceId,f.startsAt,f.endsAt,f.timezone||a.timezone]);
   await recordEvent(db,ctx.workspaceId,integrationId,{direction:'out',type:'event.update',summary:{appointmentId:a.id}});await markResult(db,integrationId,ctx.workspaceId,true);
   await addActivity(db,ctx.workspaceId,a.contact_id,ctx.memberId,'appointment',`Appointment rescheduled to ${f.startsAt}.`);await audit(db,ctx.workspaceId,ctx.memberId,'appointment.rescheduled',a.id,{startsAt:a.starts_at},{startsAt:f.startsAt});
   return {ok:true};
  });
 }
 @Delete('appointments/:id')async cancel(@Req()req:Request,@Param('id')id:string){
  const ctx=await context(req);requirePermission(ctx,'crm.edit');
  const a=await transaction(ctx.workspaceId,async db=>{const x=await lockAppointment(db,ctx.workspaceId,id);if(x.employee_id!==ctx.memberId)requirePermission(ctx,'assignment.manage');return x;});
  if(a.status==='cancelled')return {ok:true};
  const {token,integrationId}=await freshToken(ctx.workspaceId,a.employee_id);const r=await deleteEvent(http,token,a.provider_event_id);
  return inTx(ctx.workspaceId,async db=>{
   if(!r.ok){await recordEvent(db,ctx.workspaceId,integrationId,{direction:'out',type:'event.cancel',status:'failed',error:r.reason});await markResult(db,integrationId,ctx.workspaceId,false,r.reason);return {failure:r.reason};}
   await db.query("UPDATE appointments SET status='cancelled' WHERE id=$1 AND workspace_id=$2",[a.id,ctx.workspaceId]);
   await recordEvent(db,ctx.workspaceId,integrationId,{direction:'out',type:'event.cancel',summary:{appointmentId:a.id}});
   await addActivity(db,ctx.workspaceId,a.contact_id,ctx.memberId,'appointment','Appointment cancelled.');await audit(db,ctx.workspaceId,ctx.memberId,'appointment.cancelled',a.id,null,null);
   return {ok:true};
  });
 }
}
