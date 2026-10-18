import {Controller,Get,Put,Delete,Req,Param,HttpException} from '@nestjs/common';
import type {Request} from 'express';
import {z} from 'zod';
import {audit,DB} from '../db.js';
import {scoped} from '../scope.js';
import {Provider,providerFields,credentials,saveIntegration,getIntegration,publicBase,callProvider,explain,FetchLike} from './registry.js';
import {mask} from './secrets.js';
import {endpoints} from './endpoints.js';
import {checkMeta} from './whatsapp.js';
import {checkPolar} from './polar.js';
import {checkResend} from './resend.js';
export let http:FetchLike=(u,i)=>fetch(u,i);
export const setHttp=(f:FetchLike)=>{http=f};
const provider=z.enum(['polar','google','resend','whatsapp']);
/** What each integration can and cannot do, shown on the Integrations page (I5.6). */
const limits:Record<Provider,string>={
 polar:'Sandbox only: use a Polar sandbox organization, a sandbox access token and Polar’s test card. Card details are entered on Polar’s hosted checkout and never reach Relay. Payments are created against one product you choose; Relay sets the price for each request.',
 google:'Apps in testing status accept only listed test users, and refresh tokens may expire after 7 days. Each employee connects their own calendar.',
 whatsapp:'Meta’s test number only messages phone numbers on its allowed recipient list. Free-form replies work only within 24 hours of the customer’s last message; otherwise use an approved template. The temporary access token expires after about 24 hours and must be replaced.',
 resend:'Alerts are plain emails sent through Resend. The default sender (onboarding@resend.dev) can only email the address of your own Resend account; verify a domain in Resend to email any employee. Each employee can set their own alert address, which defaults to their login email.'
};
const webhookPath=(p:Provider,ws:string)=>p==='polar'?{endpoint:`${publicBase()}/api/webhooks/polar/${ws}`}:p==='google'?{redirectUri:`${publicBase()}/api/oauth/google/callback`}:p==='whatsapp'?{callbackUrl:`${publicBase()}/api/webhooks/whatsapp/${ws}`}:{};
/** Verifies freshly entered credentials against the provider before saving them. */
async function verify(p:Provider,s:Record<string,string>,c:Record<string,string>):Promise<string|null>{
 if(process.env.NODE_ENV!=='production'&&process.env.INTEGRATIONS_SKIP_VERIFY==='1')return null;
 if(p==='polar')return checkPolar(http,{accessToken:s.accessToken,productId:c.productId});
 if(p==='whatsapp')return checkMeta(http,{accessToken:s.accessToken,phoneNumberId:c.phoneNumberId});
 if(p==='resend')return checkResend(http,s.apiKey);
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
  if(p==='resend'&&config.fromAddress&&!/^([^<>@\r\n]+<[^<>@\s]+@[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+)$/.test(config.fromAddress))throw new HttpException('Enter the sender as name@example.com or Name <name@example.com>.',400);
  if(p==='polar'&&!/^[0-9a-fA-F-]{36}$/.test(config.productId||''))throw new HttpException('Enter the Polar product ID (a UUID) from your sandbox dashboard → Products.',400);
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
