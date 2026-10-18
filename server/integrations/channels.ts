import {Controller,Get,Post,Req,Res,Param,Query,HttpException,HttpCode} from '@nestjs/common';
import type {Request,Response} from 'express';
import {z} from 'zod';
import {transaction,audit,DB} from '../db.js';
import {context} from '../auth.js';
import {requirePermission,requireRecord,Context} from '../policy.js';
import {acknowledge,lockRules} from '../lead-service.js';
import {captureLead,addActivity} from '../intake.js';
import {credentials,recordEvent,markResult,publicBase,getIntegration} from './registry.js';
import {verifyPolar,createCheckout} from './polar.js';
import {http} from './manage.js';
import {verifyMeta,safeEqual,sendMeta,toE164,explainMeta} from './whatsapp.js';
const uuid=z.uuid();
const nf=(m='Record not found.')=>new HttpException(m,404);
const STOP=/^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;

/** Stores one verified inbound customer message: match or create the contact (and lead), save the message, handle opt-out, notify the owner. */
async function ingestInbound(db:DB,ws:string,m:{id:string;phone:string;name?:string;body:string;at?:Date}){
 let contact=(await db.query('SELECT * FROM contacts WHERE workspace_id=$1 AND phone=$2 AND archived_at IS NULL',[ws,m.phone])).rows[0];
 if(!contact){const created=await captureLead(db,ws,{name:m.name?.trim()||m.phone,phone:m.phone,source:'WhatsApp'});contact=(await db.query('SELECT * FROM contacts WHERE id=$1 AND workspace_id=$2',[created.contactId,ws])).rows[0];await addActivity(db,ws,contact.id,null,'created','Lead captured from WhatsApp.');}
 const conv=(await db.query("INSERT INTO conversations(workspace_id,contact_id,owner_id,channel) VALUES($1,$2,$3,'whatsapp') ON CONFLICT(workspace_id,contact_id,channel) DO UPDATE SET owner_id=conversations.owner_id RETURNING id",[ws,contact.id,contact.owner_id])).rows[0];
 const at=m.at&&!Number.isNaN(m.at.getTime())?m.at:new Date();
 await db.query("INSERT INTO messages(workspace_id,conversation_id,provider_id,body,direction,status,created_at) VALUES($1,$2,$3,$4,'in','received',$5) ON CONFLICT(workspace_id,provider_id) DO NOTHING",[ws,conv.id,m.id,m.body,at]);
 await addActivity(db,ws,contact.id,null,'message','Received a WhatsApp message.');
 if(STOP.test(m.body)){await db.query('UPDATE contacts SET opted_out=true,version=version+1 WHERE id=$1 AND workspace_id=$2',[contact.id,ws]);await addActivity(db,ws,contact.id,null,'opt-out','Contact opted out of messages.');}
 await db.query("INSERT INTO notifications(workspace_id,member_id,kind,body) VALUES($1,$2,'message',$3)",[ws,contact.owner_id,`New WhatsApp message from ${contact.name}.`]);
}

/** Sends one queued/failed outbound message through the WhatsApp (Meta Cloud API) and records the outcome. Never throws for provider failures. */
export async function deliverMessage(ws:string,messageId:string){
 const prep=await transaction(ws,async db=>{
  const m=(await db.query("SELECT m.*,c.contact_id FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.workspace_id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2 AND m.direction='out' FOR UPDATE",[messageId,ws])).rows[0];
  if(!m)throw nf();if(m.status==='sent'||m.status==='delivered')return null;
  const contact=(await db.query('SELECT phone,opted_out FROM contacts WHERE id=$1 AND workspace_id=$2',[m.contact_id,ws])).rows[0];
  if(contact.opted_out)throw new HttpException('This contact opted out of messages, so RESX cannot send to them.',409);
  const meta=await credentials(db,ws,'whatsapp');
  if(!meta)throw new HttpException('Messaging is not connected. An Admin can connect WhatsApp (Meta) on the Integrations page.',409);
  const windowClosed=!!meta&&!m.template&&!(await db.query("SELECT 1 FROM messages WHERE workspace_id=$1 AND conversation_id=$2 AND direction='in' AND created_at>now()-interval '24 hours' LIMIT 1",[ws,m.conversation_id])).rows[0];
  return {m,to:contact.phone as string,meta,windowClosed};
 });
 if(!prep)return {status:'sent'};
 const integrationId=prep.meta.id;
 const r:{ok:true;id:string}|{ok:false;reason:string}=prep.windowClosed
  ?{ok:false,reason:'WhatsApp only allows free-form replies within 24 hours of the customer’s last message. Send an approved template instead.'}
  :await sendMeta(http,{accessToken:prep.meta.secrets.accessToken,phoneNumberId:prep.meta.config.phoneNumberId,to:prep.to,body:prep.m.body,template:prep.m.template||undefined}).then(x=>x.ok?{ok:true as const,id:x.id}:x);
 return transaction(ws,async db=>{
  if(r.ok){await db.query("UPDATE messages SET status='sent',provider_id=$3,error_code=NULL WHERE id=$1 AND workspace_id=$2",[messageId,ws,r.id]);await recordEvent(db,ws,integrationId,{eventId:'out:'+r.id,direction:'out',type:'message.send',summary:{messageId,id:r.id}});await markResult(db,integrationId,ws,true);return {status:'sent'};}
  await db.query("UPDATE messages SET status='failed',error_code=$3 WHERE id=$1 AND workspace_id=$2",[messageId,ws,r.reason.slice(0,300)]);
  await recordEvent(db,ws,integrationId,{direction:'out',type:'message.send',status:'failed',summary:{messageId},error:r.reason});
  if(!prep.windowClosed)await markResult(db,integrationId,ws,false,r.reason);
  return {status:'failed',error:r.reason};
 });
}

@Controller('api')
export class ChannelController{
 @Post('contacts/:id/messages')async send(@Req()req:Request,@Param('id')contactId:string){
  const ctx=await context(req);requirePermission(ctx,'crm.edit');
  const f=z.object({body:z.string().trim().min(1).max(1600),template:z.object({name:z.string().regex(/^[a-z0-9_]{1,512}$/),language:z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/)}).strict().optional()}).strict().parse(req.body);
  const messageId=await transaction(ctx.workspaceId,async db=>{
   await lockRules(db,ctx.workspaceId);
   const c=(await db.query('SELECT * FROM contacts WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL',[uuid.parse(contactId),ctx.workspaceId])).rows[0];if(!c)throw nf();requireRecord(ctx,c.owner_id);
   if(c.opted_out)throw new HttpException('This contact opted out of messages, so RESX cannot send to them.',409);
   if(!c.phone)throw new HttpException('This contact has no phone number. Add one before sending a message.',400);
   const conv=(await db.query("INSERT INTO conversations(workspace_id,contact_id,owner_id,channel) VALUES($1,$2,$3,'whatsapp') ON CONFLICT(workspace_id,contact_id,channel) DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id",[ctx.workspaceId,c.id,c.owner_id])).rows[0];
   const m=(await db.query("INSERT INTO messages(workspace_id,conversation_id,body,direction,status,template) VALUES($1,$2,$3,'out','queued',$4) RETURNING id",[ctx.workspaceId,conv.id,f.body,f.template?JSON.stringify(f.template):null])).rows[0];
   await addActivity(db,ctx.workspaceId,c.id,ctx.memberId,'message','Sent a WhatsApp message.');
   const lead=(await db.query("SELECT * FROM leads WHERE workspace_id=$1 AND contact_id=$2 AND status='new' AND current_owner_id=$3 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[ctx.workspaceId,c.id,ctx.memberId])).rows[0];
   if(lead)await acknowledge(db,ctx,lead.id,lead.version);else await db.query('UPDATE leads SET last_activity_at=now() WHERE workspace_id=$1 AND contact_id=$2',[ctx.workspaceId,c.id]);
   return m.id as string;
  });
  return {id:messageId,...await deliverMessage(ctx.workspaceId,messageId)};
 }
 @Post('messages/:id/retry')async retry(@Req()req:Request,@Param('id')id:string){
  const ctx=await context(req);requirePermission(ctx,'crm.edit');
  await transaction(ctx.workspaceId,async db=>{const m=(await db.query("SELECT m.status,c.owner_id FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.workspace_id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2",[uuid.parse(id),ctx.workspaceId])).rows[0];if(!m)throw nf();requireRecord(ctx,m.owner_id);if(m.status!=='failed')throw new HttpException('Only failed messages can be retried.',409);});
  return deliverMessage(ctx.workspaceId,id);
 }
 // Payment request: creates a Polar checkout for for an opportunity.
 @Post('opportunities/:id/payments')async pay(@Req()req:Request,@Param('id')oppId:string){
  const ctx=await context(req);requirePermission(ctx,'crm.edit');requirePermission(ctx,'opportunity.value');
  const f=z.object({amountMinor:z.number().int().min(50).max(99999999),currency:z.string().regex(/^[A-Z]{3}$/).default('USD')}).strict().parse(req.body);
  const prep=await transaction(ctx.workspaceId,async db=>{
   const o=(await db.query('SELECT o.*,c.email,c.name AS contact_name FROM opportunities o JOIN contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id WHERE o.id=$1 AND o.workspace_id=$2 AND o.archived_at IS NULL',[uuid.parse(oppId),ctx.workspaceId])).rows[0];if(!o)throw nf();requireRecord(ctx,o.owner_id);
   const c=await credentials(db,ctx.workspaceId,'polar');if(!c)throw new HttpException('Payments are not connected. An Admin can connect Polar on the Integrations page.',409);
   const p=(await db.query("INSERT INTO payments(workspace_id,opportunity_id,requested_by,amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,'pending') RETURNING id",[ctx.workspaceId,o.id,ctx.memberId,f.amountMinor,f.currency])).rows[0];
   return {o,c,paymentId:p.id as string};
  });
  const r=await createCheckout(http,{accessToken:prep.c.secrets.accessToken,productId:prep.c.config.productId,paymentId:prep.paymentId,amountMinor:f.amountMinor,currency:f.currency,successUrl:`${publicBase()}/?payment=success`,email:prep.o.email||undefined,name:prep.o.name});
  const out=await transaction(ctx.workspaceId,async db=>{
   if(!r.ok){await db.query("UPDATE payments SET status='failed' WHERE id=$1 AND workspace_id=$2",[prep.paymentId,ctx.workspaceId]);await recordEvent(db,ctx.workspaceId,prep.c.id,{direction:'out',type:'checkout.create',status:'failed',error:r.reason});await markResult(db,prep.c.id,ctx.workspaceId,false,r.reason);return {failure:r.reason};}
   await db.query('UPDATE payments SET provider_reference=$3,checkout_url=$4 WHERE id=$1 AND workspace_id=$2',[prep.paymentId,ctx.workspaceId,r.id,r.url]);
   await recordEvent(db,ctx.workspaceId,prep.c.id,{eventId:'out:'+r.id,direction:'out',type:'checkout.create',summary:{paymentId:prep.paymentId,session:r.id}});await markResult(db,prep.c.id,ctx.workspaceId,true);
   await addActivity(db,ctx.workspaceId,prep.o.contact_id,ctx.memberId,'payment',`Payment request created for ${(f.amountMinor/100).toFixed(2)} ${f.currency}.`,prep.o.id);
   await audit(db,ctx.workspaceId,ctx.memberId,'payment.requested',prep.paymentId,null,{amountMinor:f.amountMinor,currency:f.currency});
   return {id:prep.paymentId,url:r.url};
  });
  // Thrown after the transaction so the failed status and event are kept instead of rolled back.
  if('failure' in out)throw new HttpException(String(out.failure),502);
  return out as {id:string;url:string};
 }
}

const rank:Record<string,number>={queued:0,sent:1,delivered:2,failed:2};
@Controller('api/webhooks')
export class WebhookController{
 /** Meta webhook verification handshake. Echoes hub.challenge only when the saved verify token matches. */
 @Get('whatsapp/:ws')async whatsappVerify(@Param('ws')ws:string,@Query('hub.mode')mode:string|undefined,@Query('hub.verify_token')token:string|undefined,@Query('hub.challenge')challenge:string|undefined,@Res()res:Response){
  const workspace=uuid.parse(ws);
  const c=await transaction(workspace,db=>credentials(db,workspace,'whatsapp'));
  if(mode==='subscribe'&&typeof token==='string'&&typeof challenge==='string'&&c?.secrets.verifyToken&&safeEqual(token,c.secrets.verifyToken))return res.status(200).type('text/plain').send(challenge);
  return res.status(403).type('text/plain').send('Forbidden');
 }
 @Post('whatsapp/:ws')@HttpCode(200)async whatsapp(@Req()req:Request,@Param('ws')ws:string,@Res({passthrough:true})res:Response){
  const workspace=uuid.parse(ws),raw:Buffer|undefined=(req as any).rawBody;if(!raw)throw new HttpException('Missing body.',400);
  return transaction(workspace,async db=>{
   const c=await credentials(db,workspace,'whatsapp');if(!c){res.status(403);return {error:'Messaging is not configured for this workspace.'};}
   if(!verifyMeta(c.secrets.appSecret,raw,req.header('x-hub-signature-256'))){await recordEvent(db,workspace,c.id,{direction:'in',type:'whatsapp.webhook',status:'rejected',error:'Signature verification failed.'});res.status(403);return {error:'Invalid signature.'};}
   let payload:any;try{payload=JSON.parse(raw.toString());}catch{res.status(400);return {error:'Invalid JSON.'};}
   for(const entry of Array.isArray(payload?.entry)?payload.entry:[])for(const change of Array.isArray(entry?.changes)?entry.changes:[]){
    if(change?.field!=='messages')continue;const v=change.value||{};
    if(v.metadata?.phone_number_id!==c.config.phoneNumberId){await recordEvent(db,workspace,c.id,{direction:'in',type:'whatsapp.webhook',status:'ignored',error:'Event is for a different WhatsApp phone number.'});continue;}
    const names=new Map<string,string>((Array.isArray(v.contacts)?v.contacts:[]).map((x:any)=>[String(x.wa_id),String(x.profile?.name||'')]));
    for(const m of Array.isArray(v.messages)?v.messages:[]){
     if(typeof m?.id!=='string'||typeof m?.from!=='string')continue;
     if(!await recordEvent(db,workspace,c.id,{eventId:m.id,direction:'in',type:'message.inbound',summary:{id:m.id,from:mask4(m.from),type:m.type,timestamp:m.timestamp}}))continue;
     const body=m.type==='text'?String(m.text?.body||'').slice(0,1600):`[${String(m.type||'unsupported').slice(0,30)} message]`;
     await ingestInbound(db,workspace,{id:m.id,phone:toE164(m.from),name:names.get(m.from),body,at:m.timestamp?new Date(Number(m.timestamp)*1000):undefined});
    }
    for(const st of Array.isArray(v.statuses)?v.statuses:[]){
     if(typeof st?.id!=='string'||typeof st?.status!=='string')continue;
     if(!await recordEvent(db,workspace,c.id,{eventId:`${st.id}:${st.status}`,direction:'in',type:'message.status',summary:{id:st.id,status:st.status,timestamp:st.timestamp}}))continue;
     const mapped=st.status==='delivered'||st.status==='read'?'delivered':st.status==='failed'?'failed':st.status==='sent'?'sent':'queued';
     const err=Array.isArray(st.errors)?st.errors[0]:undefined;
     const row=(await db.query("SELECT id,status FROM messages WHERE workspace_id=$1 AND provider_id=$2 AND direction='out' FOR UPDATE",[workspace,st.id])).rows[0];
     if(row&&(rank[mapped]>=(rank[row.status]??0)))await db.query('UPDATE messages SET status=$3,error_code=$4 WHERE id=$1 AND workspace_id=$2',[row.id,workspace,mapped,mapped==='failed'?explainMeta(400,{code:err?.code,message:err?.title}).slice(0,300):null]);
     if(mapped==='failed')await markResult(db,c.id,workspace,false,`Message ${st.id} failed (code ${err?.code??'unknown'}).`);
    }
   }
   await markResult(db,c.id,workspace,true);
   return {received:true};
  });
 }
 @Post('polar/:ws')@HttpCode(200)async polar(@Req()req:Request,@Param('ws')ws:string,@Res({passthrough:true})res:Response){
  const workspace=uuid.parse(ws),raw:Buffer|undefined=(req as any).rawBody;if(!raw)throw new HttpException('Missing body.',400);
  return transaction(workspace,async db=>{
   const c=await credentials(db,workspace,'polar');if(!c)throw nf('Payments are not configured for this workspace.');
   const id=req.header('webhook-id');
   if(!verifyPolar(c.secrets.webhookSecret,raw,{id,timestamp:req.header('webhook-timestamp'),signature:req.header('webhook-signature')})){await recordEvent(db,workspace,c.id,{direction:'in',type:'polar.webhook',status:'rejected',error:'Signature verification failed.'});res.status(403);return {error:'Invalid signature.'};}
   let event:any;try{event=JSON.parse(raw.toString());}catch{res.status(400);return {error:'Invalid JSON.'};}
   if(!await recordEvent(db,workspace,c.id,{eventId:id,direction:'in',type:String(event.type||'unknown'),summary:{id,type:event.type}}))return {received:true,duplicate:true};
   await applyPolarEvent(db,workspace,event);await markResult(db,c.id,workspace,true);
   return {received:true};
  });
 }
}
const mask4=(s='')=>s.length>4?'…'+s.slice(-4):'…';

/** Applies a verified Polar event. Safe to call once per webhook id (the caller de-duplicates); every write is also idempotent. */
export async function applyPolarEvent(db:DB,ws:string,event:any){
 const o=event.data||{};
 const lock='SELECT p.*,op.contact_id FROM payments p JOIN opportunities op ON op.id=p.opportunity_id AND op.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND ';
 const byCheckout=async(id?:string,paymentId?:string)=>(await db.query(lock+'(p.provider_reference=$2 OR p.id::text=$3) FOR UPDATE OF p',[ws,id||'',paymentId||''])).rows[0];
 const byOrder=async(id?:string)=>(await db.query(lock+'p.payment_intent_id=$2 FOR UPDATE OF p',[ws,id||''])).rows[0];
 const note=(p:any,text:string)=>addActivity(db,ws,p.contact_id,null,'payment',text,p.opportunity_id);
 if(event.type==='order.paid'){
  const p=await byCheckout(o.checkout_id,o.metadata?.payment_id);
  if(p&&p.status==='pending'){await db.query("UPDATE payments SET status='paid',payment_intent_id=$3,confirmed_at=now() WHERE id=$1 AND workspace_id=$2",[p.id,ws,o.id||null]);await note(p,`Payment received: ${(Number(p.amount_minor)/100).toFixed(2)} ${p.currency}.`);}
 }else if(event.type==='checkout.expired'||(event.type==='checkout.updated'&&(o.status==='expired'||o.status==='failed'))){
  const p=await byCheckout(o.id,o.metadata?.payment_id);const status=o.status==='failed'?'failed':'expired';
  if(p&&p.status==='pending'){await db.query('UPDATE payments SET status=$3 WHERE id=$1 AND workspace_id=$2',[p.id,ws,status]);await note(p,status==='failed'?'Payment attempt failed.':'Payment link expired without payment.');}
 }else if((event.type==='refund.created'||event.type==='refund.updated')&&o.status==='succeeded'){
  const p=await byOrder(o.order_id);
  if(p){
   const seen=(await db.query('SELECT 1 FROM refunds WHERE workspace_id=$1 AND provider_reference=$2 AND confirmed_at IS NOT NULL',[ws,o.id])).rows.length>0;
   await db.query('INSERT INTO refunds(workspace_id,payment_id,provider_reference,amount_minor,confirmed_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(workspace_id,provider_reference) DO UPDATE SET amount_minor=EXCLUDED.amount_minor,confirmed_at=COALESCE(refunds.confirmed_at,now())',[ws,p.id,o.id,Number(o.amount||0)]);
   const total=Number((await db.query('SELECT COALESCE(sum(amount_minor),0)::bigint AS t FROM refunds WHERE workspace_id=$1 AND payment_id=$2 AND confirmed_at IS NOT NULL',[ws,p.id])).rows[0].t);
   await db.query('UPDATE payments SET status=$3 WHERE id=$1 AND workspace_id=$2',[p.id,ws,total>=Number(p.amount_minor)?'refunded':'partially_refunded']);
   if(!seen)await note(p,`Refund recorded: ${(Number(o.amount||0)/100).toFixed(2)} ${p.currency}.`);
  }
 }
}
