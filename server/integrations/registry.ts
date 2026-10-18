import {randomUUID} from 'node:crypto';
import {DB} from '../db.js';
import {encrypt,decrypt} from './secrets.js';
export type Provider='polar'|'google'|'resend'|'whatsapp';
export type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>;
/** Which submitted fields are secrets (encrypted, never returned) and which are plain config. */
export const providerFields:Record<Provider,{secrets:string[];config:string[]}>={
 polar:{secrets:['accessToken','webhookSecret'],config:['productId']},
 google:{secrets:['clientId','clientSecret'],config:[]},
 resend:{secrets:['apiKey'],config:['fromAddress']},
 whatsapp:{secrets:['accessToken','appSecret','verifyToken'],config:['phoneNumberId','businessAccountId']}
};
export const publicBase=()=>(process.env.PUBLIC_BASE_URL||process.env.APP_ORIGIN||'http://localhost:5173').replace(/\/$/,'');
export async function getIntegration(db:DB,ws:string,provider:Provider,memberId:string|null=null){
 const r=memberId?await db.query('SELECT * FROM integrations WHERE workspace_id=$1 AND provider=$2 AND member_id=$3',[ws,provider,memberId]):await db.query('SELECT * FROM integrations WHERE workspace_id=$1 AND provider=$2 AND member_id IS NULL',[ws,provider]);
 return r.rows[0] as any|undefined;
}
export async function credentials<T=Record<string,string>>(db:DB,ws:string,provider:Provider,memberId:string|null=null):Promise<{id:string;secrets:T;config:Record<string,string>;status:string}|null>{
 const row=await getIntegration(db,ws,provider,memberId);if(!row?.secrets_encrypted)return null;
 return {id:row.id,secrets:decrypt<T>(row.secrets_encrypted),config:row.config||{},status:row.status};
}
export async function saveIntegration(db:DB,ws:string,provider:Provider,memberId:string|null,secrets:unknown,config:Record<string,string>,status='connected'){
 const existing=await getIntegration(db,ws,provider,memberId);
 if(existing){await db.query('UPDATE integrations SET secrets_encrypted=$3,config=$4,status=$5,last_error=NULL,last_error_at=NULL WHERE id=$1 AND workspace_id=$2',[existing.id,ws,encrypt(secrets),JSON.stringify(config),status]);return existing.id as string;}
 return (await db.query('INSERT INTO integrations(workspace_id,provider,member_id,secrets_encrypted,config,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[ws,provider,memberId,encrypt(secrets),JSON.stringify(config),status])).rows[0].id as string;
}
/** Records an inbound or outbound provider event. Returns false when this provider event id was already seen (replay). */
export async function recordEvent(db:DB,ws:string,integrationId:string,e:{eventId?:string;direction:'in'|'out';type:string;status?:string;summary?:Record<string,unknown>;error?:string}){
 const r=await db.query('INSERT INTO integration_events(workspace_id,integration_id,provider_event_id,direction,status,event_type,redacted_summary,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(integration_id,provider_event_id) DO NOTHING RETURNING id',[ws,integrationId,e.eventId||randomUUID(),e.direction,e.status||'ok',e.type,JSON.stringify(e.summary||{}),e.error||null]);
 return r.rows.length>0;
}
export async function markResult(db:DB,integrationId:string,ws:string,ok:boolean,error?:string){
 if(ok)await db.query("UPDATE integrations SET last_success_at=now(),last_error=NULL,last_error_at=NULL,status=CASE WHEN status='error' THEN 'connected' ELSE status END WHERE id=$1 AND workspace_id=$2",[integrationId,ws]);
 else await db.query("UPDATE integrations SET last_error=$3,last_error_at=now(),status=CASE WHEN status='connected' THEN 'error' ELSE status END WHERE id=$1 AND workspace_id=$2",[integrationId,ws,(error||'Unknown error').slice(0,300)]);
}
/** Plain-language explanation for provider failures. */
export function explain(status:number,detail=''):string{
 if(status===0)return 'The provider could not be reached. It will be retried automatically.';
 if(status===401||status===403)return 'The provider rejected the saved credentials. Reconnect the integration with fresh keys.';
 if(status===429)return 'The provider is rate limiting requests. Relay will retry shortly.';
 if(status>=500)return 'The provider had a temporary problem. Relay will retry.';
 return 'The provider refused the request'+(detail?`: ${detail.slice(0,160)}`:'.');
}
export const isTransient=(status:number)=>status===0||status===429||status>=500;
export async function callProvider(f:FetchLike,url:string,init:RequestInit):Promise<{status:number;json:any;text:string}>{
 let res:Response;try{res=await f(url,{...init,signal:AbortSignal.timeout(10000)});}catch{return {status:0,json:null,text:''};}
 const text=await res.text();let json:any=null;try{json=JSON.parse(text)}catch{/* not JSON */}
 return {status:res.status,json,text};
}
