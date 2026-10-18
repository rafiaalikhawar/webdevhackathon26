import {createHmac,timingSafeEqual} from 'node:crypto';
import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain,isTransient} from './registry.js';

/** Meta signs the raw request body: header `X-Hub-Signature-256: sha256=<hex hmac of body with the app secret>`. */
export function metaSignature(appSecret:string,raw:Buffer|string){return 'sha256='+createHmac('sha256',appSecret).update(raw).digest('hex');}
export function verifyMeta(appSecret:string,raw:Buffer|string,header:string|undefined){
 if(!header)return false;const expected=metaSignature(appSecret,raw);
 return header.length===expected.length&&timingSafeEqual(Buffer.from(header),Buffer.from(expected));
}
export function safeEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
/** Meta delivers numbers as digits without "+". CRM stores E.164. */
export const toE164=(wa:string)=>'+'+wa.replace(/\D/g,'');
export const toWaId=(e164:string)=>e164.replace(/\D/g,'');

/** Plain-language reasons for the Graph API errors a user can act on. */
export function explainMeta(status:number,err?:{code?:number;message?:string}):string{
 const code=err?.code;
 if(code===190)return 'The WhatsApp access token expired or was revoked. Generate a new token in Meta and update it on the Integrations page.';
 if(code===131047||code===131026)return 'WhatsApp only allows free-form replies within 24 hours of the customer’s last message. Send an approved template instead.';
 if(code===131030)return 'This phone number is not on the allowed recipient list for the WhatsApp test number. Add it in Meta’s API setup page.';
 if(code===130429||code===80007||status===429)return 'WhatsApp is rate limiting requests. RESX will retry shortly.';
 if(code===132000||code===132001)return 'The WhatsApp template does not exist or its parameters do not match. Check the template name and language.';
 return explain(status,err?.message);
}

export type MetaCreds={accessToken:string;phoneNumberId:string};
export async function sendMeta(f:FetchLike,c:MetaCreds&{to:string;body?:string;template?:{name:string;language:string}}){
 const payload:Record<string,unknown>={messaging_product:'whatsapp',recipient_type:'individual',to:toWaId(c.to)};
 if(c.template){payload.type='template';payload.template={name:c.template.name,language:{code:c.template.language}};}
 else{payload.type='text';payload.text={body:c.body,preview_url:false};}
 const r=await callProvider(f,`${endpoints.metaGraph()}/${c.phoneNumberId}/messages`,{method:'POST',headers:{Authorization:'Bearer '+c.accessToken,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const id=r.json?.messages?.[0]?.id;
 if(r.status>=200&&r.status<300&&id)return {ok:true as const,id:String(id)};
 return {ok:false as const,transient:isTransient(r.status),code:r.json?.error?.code as number|undefined,reason:explainMeta(r.status,r.json?.error)};
}
export async function checkMeta(f:FetchLike,c:MetaCreds){
 const r=await callProvider(f,`${endpoints.metaGraph()}/${c.phoneNumberId}?fields=display_phone_number`,{headers:{Authorization:'Bearer '+c.accessToken}});
 return r.status===200?null:explainMeta(r.status,r.json?.error);
}
