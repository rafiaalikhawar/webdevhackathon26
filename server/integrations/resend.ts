import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain,isTransient} from './registry.js';

export const DEFAULT_FROM='RESX <onboarding@resend.dev>';
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));
function explainResend(status:number,err?:{name?:string;message?:string}){
 if(status===403&&/domain|verify/i.test(err?.message||''))return 'Resend refused the sender or recipient. With the default sender (onboarding@resend.dev) you can only email the address of your own Resend account. Verify a domain in Resend to email anyone.';
 if(status===401||status===403)return 'Resend rejected the API key. Create a new key in Resend and reconnect the integration.';
 return explain(status,err?.message);
}
/** Sends one plain alert email. The idempotency key stops Resend delivering the same alert twice when RESX retries. */
export async function sendEmail(f:FetchLike,c:{apiKey:string;from:string;to:string;subject:string;text:string;link?:string;idempotencyKey?:string}){
 const html=`<p style="white-space:pre-line">${escapeHtml(c.text)}</p>${c.link?`<p><a href="${escapeHtml(c.link)}">Open the lead</a></p>`:''}`;
 const headers:Record<string,string>={Authorization:'Bearer '+c.apiKey,'Content-Type':'application/json'};if(c.idempotencyKey)headers['Idempotency-Key']=c.idempotencyKey;
 const r=await callProvider(f,`${endpoints.resend()}/emails`,{method:'POST',headers,body:JSON.stringify({from:c.from,to:[c.to],subject:c.subject,text:c.text,html})});
 if(r.status>=200&&r.status<300&&r.json?.id)return {ok:true as const,id:String(r.json.id)};
 return {ok:false as const,transient:isTransient(r.status),reason:explainResend(r.status,r.json)};
}
/** Key check on save. Sending-only keys cannot list domains and answer 401 restricted_api_key, which still proves the key is real. */
export async function checkResend(f:FetchLike,apiKey:string){
 const r=await callProvider(f,`${endpoints.resend()}/domains`,{headers:{Authorization:'Bearer '+apiKey}});
 if(r.status===200)return null;
 if(r.status===401&&r.json?.name==='restricted_api_key')return null;
 return explainResend(r.status===0?0:401,r.json);
}
