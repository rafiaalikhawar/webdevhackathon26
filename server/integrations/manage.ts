import {Controller,Get,Put,Delete,Req,Param,HttpException} from '@nestjs/common';
import type {Request} from 'express';
import {z} from 'zod';
import {audit,DB} from '../db.js';
import {scoped} from '../scope.js';
import {Provider,providerFields,credentials,saveIntegration,getIntegration,publicBase,callProvider,explain,FetchLike} from './registry.js';
import {mask} from './secrets.js';
import {endpoints} from './endpoints.js';
import {checkMeta} from './whatsapp.js';
export let http:FetchLike=(u,i)=>fetch(u,i);
export const setHttp=(f:FetchLike)=>{http=f};
const provider=z.enum(['twilio','stripe','google','telegram','whatsapp']);
/** What each integration can and cannot do, shown on the Integrations page (I5.6). */
const limits:Record<Provider,string>={
 twilio:'WhatsApp sandbox only reaches phones that have joined it by sending the join phrase. Sandbox messages are for testing, and customers must have messaged first within 24 hours for free-form replies.',
 stripe:'Test mode only: use Stripe test cards. Card details are entered on Stripe’s hosted page and never reach Relay.',
 google:'Apps in testing status accept only listed test users, and refresh tokens may expire after 7 days. Each employee connects their own calendar.',
 whatsapp:'Meta’s test number only messages phone numbers on its allowed recipient list. Free-form replies work only within 24 hours of the customer’s last message; otherwise use an approved template. The temporary access token expires after about 24 hours and must be replaced.',
 telegram:'Alerts reach only people who have started a chat with your bot. Each employee sets their own chat id.'
};
const webhookPath=(p:Provider,ws:string)=>p==='twilio'?{inbound:`${publicBase()}/api/webhooks/twilio/${ws}/inbound`,status:`${publicBase()}/api/webhooks/twilio/${ws}/status`}:p==='stripe'?{endpoint:`${publicBase()}/api/webhooks/stripe/${ws}`}:p==='google'?{redirectUri:`${publicBase()}/api/oauth/google/callback`}:p==='whatsapp'?{callbackUrl:`${publicBase()}/api/webhooks/whatsapp/${ws}`}:{};
/** Verifies freshly entered credentials against the provider before saving them. */
async function verify(p:Provider,s:Record<string,string>,c:Record<string,string>):Promise<string|null>{
 if(process.env.NODE_ENV!=='production'&&process.env.INTEGRATIONS_SKIP_VERIFY==='1')return null;
 if(p==='twilio'){const r=await callProvider(http,`${endpoints.twilio()}/2010-04-01/Accounts/${s.accountSid}.json`,{headers:{Authorization:'Basic '+Buffer.from(`${s.accountSid}:${s.authToken}`).toString('base64')}});return r.status===200?null:explain(r.status,r.json?.message);}
 if(p==='stripe'){const r=await callProvider(http,`${endpoints.stripe()}/v1/balance`,{headers:{Authorization:'Bearer '+s.secretKey}});if(r.status!==200)return explain(r.status,r.json?.error?.message);if(s.secretKey.startsWith('sk_live'))return 'Live keys are not allowed. Use Stripe test mode keys (sk_test_…).';return null;}
 if(p==='whatsapp')return checkMeta(http,{accessToken:s.accessToken,phoneNumberId:c.phoneNumberId});
 if(p==='telegram'){const r=await callProvider(http,`${endpoints.telegram()}/bot${s.botToken}/getMe`,{});return r.status===200&&r.json?.ok?null:explain(r.status,r.json?.description);}
 return null;
}
@Controller('api/integrations')
export class IntegrationsController{
 @Get()list(@Req()req:Request){return scoped(req,'integration.manage',async(db,ctx)=>{
  const out:any[]=[];
  for(const p of Object.keys(providerFields) as Provider[]){
   const row=await getIntegration(db,ctx.workspaceId,p);const cred=row?.secrets_encrypted?await credentials(db,ctx.workspaceId,p):null;
   const events=row?(await db.query('SELECT id,direction,event_type,status,error,created_at,redacted_summary FROM integration_events WHERE workspace_id=$1 AND integration_id=$2 ORDER BY created_at DESC LIMIT 8',[ctx.workspaceId,row.id])).rows:[];
   out.push({provider:p,status:row?.status==='not_connected'||!cred?'not_connected':row.status,lastSuccessAt:row?.last_success_at||null,lastError:row?.last_error||null,lastErrorAt:row?.last_error_at||null,config:row?.config||{},secrets:cred?Object.fromEntries(Object.entries(cred.secrets).filter(([k])=>providerFields[p].secrets.includes(k)).map(([k,v])=>[k,mask(String(v))])):{},fields:providerFields[p],webhooks:webhookPath(p,ctx.workspaceId),limits:limits[p],events});
  }
  return out;});}
 @Get('events')history(@Req()req:Request){return scoped(req,'integration.manage',async(db,ctx)=>(await db.query('SELECT e.id,i.provider,e.direction,e.event_type,e.status,e.error,e.attempts,e.created_at,e.redacted_summary FROM integration_events e JOIN integrations i ON i.id=e.integration_id AND i.workspace_id=e.workspace_id WHERE e.workspace_id=$1 ORDER BY e.created_at DESC LIMIT 100',[ctx.workspaceId])).rows);}
 @Put(':provider')save(@Req()req:Request,@Param('provider')prov:string){return scoped(req,'integration.manage',async(db:DB,ctx)=>{
  const p=provider.parse(prov);const spec=providerFields[p];
  const body=z.record(z.string(),z.string().trim().max(500)).parse(req.body);
  for(const k of Object.keys(body))if(![...spec.secrets,...spec.config].includes(k))throw new HttpException(`Unknown field: ${k}.`,400);
  const existing=await credentials(db,ctx.workspaceId,p);
  const secrets:Record<string,string>={...(existing?.secrets||{})},config:Record<string,string>={...(existing?.config||{})};
  for(const k of spec.secrets)if(body[k])secrets[k]=body[k];for(const k of spec.config)if(k in body)config[k]=body[k];
  const missing=spec.secrets.filter(k=>!secrets[k]);if(missing.length)throw new HttpException(`Missing required fields: ${missing.join(', ')}.`,400);
  if(p==='twilio'&&!config.whatsappFrom)throw new HttpException('Enter the sandbox WhatsApp number, for example +14155238886.',400);
  if(p==='whatsapp'&&!/^\d{5,20}$/.test(config.phoneNumberId||''))throw new HttpException('Enter the WhatsApp Phone number ID from Meta’s API setup page (digits only).',400);
  const problem=await verify(p,secrets,config);if(problem)throw new HttpException(problem,400);
  await saveIntegration(db,ctx.workspaceId,p,null,secrets,config);
  await audit(db,ctx.workspaceId,ctx.memberId,'integration.connected',null,{connected:!!existing},{provider:p,fields:Object.keys(body)});
  return {ok:true};});}
 @Delete(':provider')remove(@Req()req:Request,@Param('provider')prov:string){return scoped(req,'integration.manage',async(db,ctx)=>{
  const p=provider.parse(prov);const row=await getIntegration(db,ctx.workspaceId,p);if(!row)throw new HttpException('Integration not found.',404);
  await db.query("UPDATE integrations SET secrets_encrypted=NULL,config='{}',status='not_connected' WHERE id=$1 AND workspace_id=$2",[row.id,ctx.workspaceId]);
  if(p==='google')await db.query("DELETE FROM integrations WHERE workspace_id=$1 AND provider='google' AND member_id IS NOT NULL",[ctx.workspaceId]);
  await audit(db,ctx.workspaceId,ctx.memberId,'integration.removed',null,{provider:p},null);return {ok:true};});}
}
