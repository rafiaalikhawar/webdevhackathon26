import {createHmac,timingSafeEqual} from 'node:crypto';
import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain} from './registry.js';

/**
 * Polar signs webhooks with the Standard Webhooks scheme: headers webhook-id, webhook-timestamp, webhook-signature ("v1,<base64>" values, space separated),
 * HMAC-SHA256 over `${id}.${timestamp}.${rawBody}`. Secrets issued before 8 Sep 2026 use the UTF-8 bytes of the whole string as the key,
 * newer ones use the base64 part after "whsec_". Both keys are tried.
 */
export function verifyPolar(secret:string,rawBody:Buffer|string,h:{id?:string;timestamp?:string;signature?:string},toleranceSeconds=300,now=Date.now()/1000){
 if(!h.id||!h.timestamp||!h.signature)return false;const t=Number(h.timestamp);if(!t||Math.abs(now-t)>toleranceSeconds)return false;
 const keys=[Buffer.from(secret,'utf8')];const b64=secret.replace(/^whsec_/,'');if(/^[A-Za-z0-9+/=]+$/.test(b64))keys.push(Buffer.from(b64,'base64'));
 const body=`${h.id}.${h.timestamp}.${rawBody.toString()}`;
 const given=h.signature.split(' ').filter(p=>p.startsWith('v1,')).map(p=>p.slice(3));
 return keys.some(k=>{const expected=createHmac('sha256',k).update(body).digest('base64');return given.some(g=>g.length===expected.length&&timingSafeEqual(Buffer.from(g),Buffer.from(expected)));});
}

export type PolarCreds={accessToken:string;productId:string};
/** Creates a checkout with a one-off fixed price for this payment request. Polar needs an existing product; the price is set ad hoc. */
export async function createCheckout(f:FetchLike,c:PolarCreds&{paymentId:string;amountMinor:number;currency:string;successUrl:string;email?:string;name?:string}){
 const body:Record<string,unknown>={products:[c.productId],prices:{[c.productId]:[{amount_type:'fixed',price_amount:c.amountMinor,price_currency:c.currency.toLowerCase()}]},metadata:{payment_id:c.paymentId},success_url:c.successUrl,allow_discount_codes:false};
 if(c.email)body.customer_email=c.email;
 const r=await callProvider(f,`${endpoints.polar()}/v1/checkouts/`,{method:'POST',headers:{Authorization:'Bearer '+c.accessToken,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
 if((r.status===200||r.status===201)&&r.json?.url)return {ok:true as const,id:String(r.json.id),url:String(r.json.url)};
 const detail=r.json?.detail;const msg=typeof detail==='string'?detail:Array.isArray(detail)?detail.map((d:any)=>d.msg).join('; '):r.json?.error_description;
 return {ok:false as const,reason:explain(r.status,msg)};
}
export async function checkPolar(f:FetchLike,c:PolarCreds){
 const r=await callProvider(f,`${endpoints.polar()}/v1/products/${c.productId}`,{headers:{Authorization:'Bearer '+c.accessToken,Accept:'application/json'}});
 return r.status===200?null:explain(r.status,r.status===404?'Product not found in this Polar environment.':r.json?.detail);
}
