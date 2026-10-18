// Thin client for the RESX API. Session is an HttpOnly cookie; the CSRF token is readable and echoed in a header.
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
const KEY='relay-workspace';
export const workspaceId=()=>{try{return localStorage.getItem(KEY)||''}catch{return ''}};
export const setWorkspaceId=(id:string)=>{try{id?localStorage.setItem(KEY,id):localStorage.removeItem(KEY)}catch{/* storage unavailable */}};
const csrf=()=>document.cookie.split('; ').find(c=>c.startsWith('relay_csrf='))?.split('=')[1]||'';
let onUnauthorized:()=>void=()=>{};
export const onSessionExpired=(fn:()=>void)=>{onUnauthorized=fn};
export async function api<T=any>(method:string,path:string,body?:unknown):Promise<T>{
 const headers:Record<string,string>={'Content-Type':'application/json'};
 const ws=workspaceId();if(ws)headers['X-Workspace-Id']=ws;
 if(method!=='GET')headers['X-CSRF-Token']=csrf();
 let res:Response;
 try{res=await fetch('/api'+path,{method,headers,credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body)});}
 catch{throw new ApiError('Cannot reach the server. Check your connection and try again.',0);}
 const text=await res.text();let json:any=null;try{json=text?JSON.parse(text):null}catch{/* non-JSON */}
 if(!res.ok){if(res.status===401&&path!=='/auth/login')onUnauthorized();throw new ApiError(json?.error||json?.message||'The request failed. Please try again.',res.status);}
 return json as T;
}
export const errorText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';
