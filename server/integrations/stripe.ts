import {createHmac,timingSafeEqual} from 'node:crypto';
import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain} from './registry.js';
/** Stripe-Signature: t=<unix>,v1=<hmac>. HMAC-SHA256 of `${t}.${rawBody}`; rejects stale timestamps. */
export function verifyStripe(secret:string,rawBody:Buffer|string,header:string|undefined,toleranceSeconds=300,now=Date.now()/1000){
 if(!header)return false;const parts=Object.fromEntries(header.split(',').map(p=>p.split('=') as [string,string]));const t=Number(parts.t);if(!t||Math.abs(now-t)>toleranceSeconds)return false;
 const expected=createHmac('sha256',secret).update(`${t}.${rawBody.toString()}`).digest('hex');
 const candidates=header.split(',').filter(p=>p.startsWith('v1=')).map(p=>p.slice(3));
 return candidates.some(c=>c.length===expected.length&&timingSafeEqual(Buffer.from(c),Buffer.from(expected)));
}
export async function createCheckout(f:FetchLike,c:{secretKey:string;paymentId:string;amountMinor:number;currency:string;name:string;successUrl:string;cancelUrl:string;email?:string}){
 const form=new URLSearchParams({mode:'payment','line_items[0][quantity]':'1','line_items[0][price_data][currency]':c.currency.toLowerCase(),'line_items[0][price_data][unit_amount]':String(c.amountMinor),'line_items[0][price_data][product_data][name]':c.name,success_url:c.successUrl,cancel_url:c.cancelUrl,client_reference_id:c.paymentId,'metadata[payment_id]':c.paymentId,'payment_intent_data[metadata][payment_id]':c.paymentId});
 if(c.email)form.set('customer_email',c.email);
 const r=await callProvider(f,`${endpoints.stripe()}/v1/checkout/sessions`,{method:'POST',headers:{Authorization:'Bearer '+c.secretKey,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'checkout-'+c.paymentId},body:form});
 if(r.status===200&&r.json?.url)return {ok:true as const,id:String(r.json.id),url:String(r.json.url)};
 return {ok:false as const,reason:explain(r.status,r.json?.error?.message)};
}
