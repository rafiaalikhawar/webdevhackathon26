import React,{useState} from 'react';
/** Public lead-capture page: /form/<workspaceId>. No sign-in; posts to the public intake endpoint. */
export function PublicForm({workspaceId}:{workspaceId:string}){
 const [state,setState]=useState<'idle'|'busy'|'done'>('idle'),[error,setError]=useState('');
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setState('busy');setError('');const f=Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string,string>;
  const body:Record<string,string>={name:f.name};for(const k of ['company','email','phone','message'])if(f[k]?.trim())body[k]=f[k].trim();
  try{const r=await fetch(`/api/public/leads/${workspaceId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'We could not send your request. Please try again.');setState('done')}catch(err){setError(err instanceof Error?err.message:'Something went wrong.');setState('idle')}}
 if(state==='done')return <div className="auth-page"><div className="auth-card" role="status"><h1>Thank you</h1><p className="auth-sub">We received your request and someone will reply shortly.</p></div></div>;
 return <div className="auth-page"><form className="auth-card" onSubmit={submit} aria-labelledby="form-title"><h1 id="form-title">Talk to us</h1><p className="auth-sub">Leave your details and we will get back to you.</p>
  <label>Your name<input name="name" required maxLength={150} autoComplete="name"/></label>
  <label>Company (optional)<input name="company" maxLength={150} autoComplete="organization"/></label>
  <label>Email<input name="email" type="email" maxLength={254} autoComplete="email"/></label>
  <label>Phone (with country code, e.g. +12025550100)<input name="phone" type="tel" pattern="\+[1-9][0-9]{7,14}" autoComplete="tel"/></label>
  <label>How can we help?<textarea name="message" maxLength={2000} rows={4}/></label>
  <p className="field-help">Please give an email or a phone number.</p>
  {error&&<div className="form-error" role="alert">{error}</div>}
  <button className="btn primary full" disabled={state==='busy'}>{state==='busy'?'Sending…':'Send'}</button></form></div>;
}
