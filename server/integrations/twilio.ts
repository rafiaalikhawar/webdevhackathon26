import {createHmac,timingSafeEqual} from 'node:crypto';
import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain,isTransient} from './registry.js';
/** Twilio request validation: HMAC-SHA1 over the full URL plus sorted POST params, base64-encoded. */
export function twilioSignature(authToken:string,url:string,params:Record<string,string>){
 const data=url+Object.keys(params).sort().map(k=>k+params[k]).join('');
 return createHmac('sha1',authToken).update(data).digest('base64');
}
export function verifyTwilio(authToken:string,url:string,params:Record<string,string>,header:string|undefined){
 if(!header)return false;const expected=twilioSignature(authToken,url,params);
 return header.length===expected.length&&timingSafeEqual(Buffer.from(header),Buffer.from(expected));
}
export const stripWhatsapp=(v:string)=>v.replace(/^whatsapp:/,'');
export async function sendTwilio(f:FetchLike,c:{accountSid:string;authToken:string;from:string;to:string;body:string;statusCallback:string}){
 const form=new URLSearchParams({To:`whatsapp:${c.to}`,From:c.from.startsWith('whatsapp:')?c.from:`whatsapp:${c.from}`,Body:c.body,StatusCallback:c.statusCallback});
 const r=await callProvider(f,`${endpoints.twilio()}/2010-04-01/Accounts/${c.accountSid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:form});
 if(r.status>=200&&r.status<300)return {ok:true as const,sid:String(r.json?.sid)};
 return {ok:false as const,transient:isTransient(r.status),reason:r.json?.message?`${explain(r.status,r.json.message)}`:explain(r.status)};
}
