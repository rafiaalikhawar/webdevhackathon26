import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain,isTransient} from './registry.js';
export async function sendTelegram(f:FetchLike,botToken:string,chatId:string,text:string){
 const r=await callProvider(f,`${endpoints.telegram()}/bot${botToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
 if(r.status===200&&r.json?.ok)return {ok:true as const};
 return {ok:false as const,transient:isTransient(r.status),reason:explain(r.status,r.json?.description)};
}
