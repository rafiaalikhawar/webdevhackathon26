import React,{useState} from 'react';
import {api,setWorkspaceId,errorText} from './api';
type Mode='login'|'signup'|'invite';
/** Sign in / sign up / accept-invite. On success it stores the workspace id and calls onDone. */
export function AuthScreen({onDone,notice}:{onDone:()=>void;notice?:string}){
 const params=new URLSearchParams(location.search),inviteToken=params.get('invite'),inviteWs=params.get('ws');
 const [mode,setMode]=useState<Mode>(inviteToken&&inviteWs?'invite':'login'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();setError('');setBusy(true);
  const f=Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string,string>;
  try{
   if(mode==='signup'){const r=await api('POST','/auth/signup',{email:f.email,password:f.password,name:f.name,workspace:f.workspace});setWorkspaceId(r.workspace.id);}
   else if(mode==='invite'){const r=await api('POST','/public/accept-invite',{token:inviteToken,workspaceId:inviteWs,email:f.email,password:f.password,name:f.name});setWorkspaceId(r.workspace.id);history.replaceState(null,'','/');}
   else{const r=await api('POST','/auth/login',{email:f.email,password:f.password});if(!r.workspaces?.length)throw new Error('This account has no active workspace.');setWorkspaceId(r.workspaces[0].id);}
   onDone();
  }catch(err){setError(errorText(err));}finally{setBusy(false);}
 }
 return <div className="auth-page"><form className="auth-card" onSubmit={submit} aria-labelledby="auth-title">
  <div className="brand-lockup"><span className="brand-mark"><span/><span/><span/></span><span className="brand-name">relay<span className="brand-period">.</span></span></div>
  <h1 id="auth-title">{mode==='login'?'Welcome back':mode==='signup'?'Create your workspace':'Join your team'}</h1>
  <p className="auth-sub">{mode==='login'?'Sign in to keep every lead accounted for.':mode==='signup'?'You will be the Owner of a new, private workspace.':'Create your account to accept the invitation.'}</p>
  {notice&&<div className="notice warning compact" role="status">{notice}</div>}
  {mode!=='login'&&<label>Your name<input name="name" required maxLength={150} autoComplete="name"/></label>}
  {mode==='signup'&&<label>Company / workspace name<input name="workspace" required maxLength={150}/></label>}
  <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
  <label>Password<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'}/></label>
  {mode!=='login'&&<p className="field-help">Use at least 12 characters.</p>}
  {error&&<div className="form-error" role="alert">{error}</div>}
  <button className="btn primary full" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in':mode==='signup'?'Create workspace':'Accept invitation'}</button>
  {mode!=='invite'&&<button type="button" className="link-btn" onClick={()=>{setError('');setMode(mode==='login'?'signup':'login')}}>{mode==='login'?'New here? Create a workspace':'Already have an account? Sign in'}</button>}
 </form></div>;
}
