import {endpoints} from './endpoints.js';
import {FetchLike,callProvider,explain} from './registry.js';
export const SCOPE='https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy';
export const authUrl=(clientId:string,redirectUri:string,state:string)=>'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state}).toString();
export type Tokens={accessToken:string;refreshToken?:string;expiresAt:number};
export async function exchangeCode(f:FetchLike,c:{clientId:string;clientSecret:string;code:string;redirectUri:string}){
 const r=await callProvider(f,endpoints.googleToken(),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:c.code,client_id:c.clientId,client_secret:c.clientSecret,redirect_uri:c.redirectUri,grant_type:'authorization_code'})});
 if(r.status!==200)return {ok:false as const,reason:explain(r.status,r.json?.error_description)};
 return {ok:true as const,tokens:{accessToken:r.json.access_token,refreshToken:r.json.refresh_token,expiresAt:Date.now()+r.json.expires_in*1000} as Tokens};
}
/** invalid_grant means the user revoked access or the token expired: the caller must mark the connection as needing reconnection. */
export async function refresh(f:FetchLike,c:{clientId:string;clientSecret:string;refreshToken:string}){
 const r=await callProvider(f,endpoints.googleToken(),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:c.refreshToken,grant_type:'refresh_token'})});
 if(r.status===200)return {ok:true as const,accessToken:r.json.access_token as string,expiresAt:Date.now()+r.json.expires_in*1000};
 return {ok:false as const,revoked:r.json?.error==='invalid_grant',reason:r.json?.error==='invalid_grant'?'Google access was revoked or expired. Reconnect your calendar.':explain(r.status,r.json?.error_description)};
}
const auth=(t:string)=>({Authorization:'Bearer '+t,'Content-Type':'application/json'});
export async function busyTimes(f:FetchLike,token:string,from:string,to:string){
 const r=await callProvider(f,`${endpoints.googleCalendar()}/freeBusy`,{method:'POST',headers:auth(token),body:JSON.stringify({timeMin:from,timeMax:to,items:[{id:'primary'}]})});
 if(r.status!==200)return {ok:false as const,status:r.status,reason:explain(r.status,r.json?.error?.message)};
 return {ok:true as const,busy:(r.json?.calendars?.primary?.busy||[]) as {start:string;end:string}[]};
}
export const overlaps=(busy:{start:string;end:string}[],start:string,end:string)=>busy.filter(b=>Date.parse(b.start)<Date.parse(end)&&Date.parse(b.end)>Date.parse(start));
export async function createEvent(f:FetchLike,token:string,e:{title:string;description?:string;start:string;end:string;timezone:string;attendeeEmail?:string}){
 const body={summary:e.title,description:e.description,start:{dateTime:e.start,timeZone:e.timezone},end:{dateTime:e.end,timeZone:e.timezone},...(e.attendeeEmail?{attendees:[{email:e.attendeeEmail}]}:{})};
 const r=await callProvider(f,`${endpoints.googleCalendar()}/calendars/primary/events`,{method:'POST',headers:auth(token),body:JSON.stringify(body)});
 return r.status===200?{ok:true as const,id:String(r.json.id)}:{ok:false as const,status:r.status,reason:explain(r.status,r.json?.error?.message)};
}
export async function patchEvent(f:FetchLike,token:string,id:string,e:{start:string;end:string;timezone:string}){
 const r=await callProvider(f,`${endpoints.googleCalendar()}/calendars/primary/events/${encodeURIComponent(id)}`,{method:'PATCH',headers:auth(token),body:JSON.stringify({start:{dateTime:e.start,timeZone:e.timezone},end:{dateTime:e.end,timeZone:e.timezone}})});
 return r.status===200?{ok:true as const}:{ok:false as const,status:r.status,reason:explain(r.status,r.json?.error?.message)};
}
export async function deleteEvent(f:FetchLike,token:string,id:string){
 const r=await callProvider(f,`${endpoints.googleCalendar()}/calendars/primary/events/${encodeURIComponent(id)}`,{method:'DELETE',headers:auth(token)});
 return r.status===204||r.status===410||r.status===404?{ok:true as const}:{ok:false as const,status:r.status,reason:explain(r.status,r.json?.error?.message)};
}
