import React,{useCallback,useEffect,useState} from 'react';
import {ArrowUpRight,ShieldCheck,TriangleAlert,X} from 'lucide-react';
import {api,errorText} from './api';

type Prov={provider:'twilio'|'stripe'|'google'|'telegram'|'whatsapp';status:string;lastSuccessAt:string|null;lastError:string|null;config:Record<string,string>;secrets:Record<string,string>;fields:{secrets:string[];config:string[]};webhooks:Record<string,string>;limits:string;events:{id:string;direction:string;event_type:string;status:string;error:string|null;created_at:string}[]};
const meta:Record<string,{name:string;letter:string;color:string;category:string;text:string;labels:Record<string,string>;help:string}>={
 twilio:{name:'Twilio',letter:'••',color:'twilio',category:'Messaging',text:'Capture leads from incoming WhatsApp messages and reply from Relay.',labels:{accountSid:'Account SID',authToken:'Auth token',whatsappFrom:'Sandbox WhatsApp number (e.g. +14155238886)'},help:'Console → Messaging → Try it out → WhatsApp. Paste the webhook URLs below into the sandbox settings.'},
 whatsapp:{name:'WhatsApp (Meta)',letter:'W',color:'twilio',category:'Messaging',text:'Capture leads from WhatsApp Cloud API messages and reply from Relay.',labels:{accessToken:'Access token',appSecret:'Meta app secret',verifyToken:'Webhook verify token (choose any long random string)',phoneNumberId:'Phone number ID',businessAccountId:'WhatsApp Business Account ID (optional)'},help:'Meta for Developers → your app → WhatsApp → API setup. Under Configuration, paste the callback URL below and the same verify token, then subscribe to the messages field.'},
 stripe:{name:'Stripe',letter:'S',color:'stripe',category:'Payments',text:'Create payment links and receive verified payment and refund events.',labels:{secretKey:'Secret key (sk_test_…)',webhookSecret:'Webhook signing secret (whsec_…)'},help:'Developers → API keys, then add the endpoint below under Webhooks and copy its signing secret.'},
 google:{name:'Google Calendar',letter:'31',color:'google',category:'Scheduling',text:'Each employee connects their own calendar to book appointments.',labels:{clientId:'OAuth client ID',clientSecret:'OAuth client secret'},help:'Google Cloud → Enable Calendar API → OAuth consent (add test users) → Web client. Add the redirect URI below. Employees then connect from the Calendar page.'},
 telegram:{name:'Telegram',letter:'↗',color:'telegram',category:'Escalation alerts',text:'Alert the new owner outside Relay when a lead escalates.',labels:{botToken:'Bot token'},help:'Create a bot with @BotFather and paste its token. Each employee then adds their own chat id on this page.'}
};
const tone=(s:string)=>s==='connected'?'green':s==='error'||s==='needs_reconnect'?'red':'neutral';
const label=(s:string)=>s==='connected'?'Connected':s==='error'?'Error':s==='needs_reconnect'?'Needs reconnection':'Not connected';
const when=(d:string|null)=>d?new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Never';

export function IntegrationsPage({canManage,destination,notify,onChanged}:{canManage:boolean;destination:string;notify:(t:string,e?:boolean)=>void;onChanged:()=>void}){
 const [items,setItems]=useState<Prov[]|null>(null),[history,setHistory]=useState<any[]>([]),[edit,setEdit]=useState<Prov|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[chat,setChat]=useState(destination);
 const load=useCallback(async()=>{try{if(canManage){setItems(await api('GET','/integrations'));setHistory(await api('GET','/integrations/events'));}else setItems([])}catch(e){notify(errorText(e),true);setItems([])}},[canManage]);
 useEffect(()=>{load();const t=setInterval(load,8000);return()=>clearInterval(t)},[load]);
 async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(!edit)return;setBusy(true);setError('');const f=Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string,string>;const body=Object.fromEntries(Object.entries(f).filter(([,v])=>v!==''));
  try{await api('PUT','/integrations/'+edit.provider,body);notify(`${meta[edit.provider].name} saved and verified.`);setEdit(null);await load();onChanged();}catch(err){setError(errorText(err))}finally{setBusy(false)}}
 async function disconnect(p:Prov){if(!confirm(`Disconnect ${meta[p.provider].name}? Stored credentials will be deleted.`))return;try{await api('DELETE','/integrations/'+p.provider);notify(`${meta[p.provider].name} disconnected.`);await load();onChanged();}catch(err){notify(errorText(err),true)}}
 async function saveChat(e:React.FormEvent){e.preventDefault();try{await api('PUT','/me/destination',{address:chat});notify('Your Telegram chat id was saved.');onChanged();}catch(err){notify(errorText(err),true)}}
 return <>
  <div className="notice"><ShieldCheck size={19}/><div><strong>Your workspace. Your connections.</strong><p>Each workspace connects its own accounts. Secrets are encrypted on the server and only their last four characters are ever shown.</p></div></div>
  {!canManage&&<div className="notice warning compact" role="status"><TriangleAlert size={17}/>Only people with the “manage integrations” permission can view or change connections.</div>}
  <div className="integrations-grid">{(items||[]).map(p=>{const m=meta[p.provider];return <section className="panel integration-card" key={p.provider}>
   <div className="integration-top"><span className={`integration-logo ${m.color}`}>{m.letter}</span><span className={`badge ${tone(p.status)}`}><span className="badge-dot"/>{label(p.status)}</span></div>
   <small>{m.category}</small><h2>{m.name}</h2><p>{m.text}</p>
   <div className="integration-features">Last success: {when(p.lastSuccessAt)}</div>
   {p.lastError&&<div className="form-error" role="alert"><TriangleAlert size={15}/>{p.lastError}</div>}
   <p className="field-help">{p.limits}</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn" onClick={()=>{setError('');setEdit(p)}}>{p.status==='not_connected'?'Set up':'Edit'} {m.name}<ArrowUpRight size={14}/></button>{p.status!=='not_connected'&&<button className="btn" onClick={()=>disconnect(p)}>Disconnect</button>}</div>
  </section>})}</div>
  <section className="panel sync-panel" style={{marginTop:16}}><div className="panel-heading"><h2>Your alert destination</h2></div><form onSubmit={saveChat} style={{display:'flex',gap:8,flexWrap:'wrap',padding:'0 16px 16px'}}><label style={{flex:1,minWidth:220}}>Telegram chat id<input value={chat} onChange={e=>setChat(e.target.value)} placeholder="e.g. 123456789" inputMode="numeric"/></label><button className="btn primary" style={{alignSelf:'end'}}>Save</button></form><p className="field-help" style={{padding:'0 16px 16px'}}>Message your bot once, then enter your numeric chat id. Escalated leads are sent here.</p></section>
  <section className="panel sync-panel" style={{marginTop:16}}><div className="panel-heading"><h2>Synchronization history</h2><span className="muted">{history.length?`${history.length} recent events`:'No provider events yet'}</span></div>
   {history.length?<div className="table-wrap"><table><thead><tr><th>Time</th><th>Provider</th><th>Direction</th><th>Event</th><th>Result</th></tr></thead><tbody>{history.map(h=><tr key={h.id}><td>{when(h.created_at)}</td><td>{h.provider}</td><td>{h.direction==='in'?'Inbound':'Outbound'}</td><td>{h.event_type}</td><td><span className={`badge ${h.status==='ok'?'green':h.status==='retrying'?'amber':'red'}`}><span className="badge-dot"/>{h.status}</span>{h.error&&<small style={{display:'block'}}>{h.error}</small>}</td></tr>)}</tbody></table></div>:<p className="field-help" style={{padding:16}}>Connection activity, delivery results and errors appear here.</p>}
  </section>
  {edit&&<div className="modal-overlay" onClick={()=>setEdit(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="int-title" onClick={e=>e.stopPropagation()}>
   <div className="modal-heading"><h2 id="int-title">{meta[edit.provider].name}</h2><button className="icon-btn" aria-label="Close dialog" onClick={()=>setEdit(null)}><X size={16}/></button></div>
   <form onSubmit={save}><p className="modal-description">{meta[edit.provider].help}</p>
    {[...edit.fields.secrets,...edit.fields.config].map(k=>{const isSecret=edit.fields.secrets.includes(k);return <label key={k}>{meta[edit.provider].labels[k]||k}<input name={k} type={isSecret?'password':'text'} autoComplete="off" placeholder={isSecret?(edit.secrets[k]||'Not set'):''} defaultValue={isSecret?'':edit.config[k]||''} required={!isSecret&&!edit.config[k]||isSecret&&!edit.secrets[k]}/></label>})}
    {Object.keys(edit.webhooks).length>0&&<div className="notice compact"><div><strong>Paste into {meta[edit.provider].name}</strong>{Object.entries(edit.webhooks).map(([k,v])=><p key={k} style={{wordBreak:'break-all'}}><b>{k}:</b> {v}</p>)}<p className="field-help">These need a public HTTPS address. Set PUBLIC_BASE_URL to your tunnel or deployment.</p></div></div>}
    {edit.status!=='not_connected'&&<p className="field-help">Leave a secret blank to keep the stored one.</p>}
    {error&&<div className="form-error" role="alert"><TriangleAlert size={15}/>{error}</div>}
    <div className="modal-actions"><button type="button" className="btn" onClick={()=>setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Verifying…':'Save and verify'}</button></div>
   </form></section></div>}
 </>;
}

/** Converts a wall-clock time in an IANA zone to a UTC ISO instant. */
export function zonedInstant(local:string,tz:string){
 const [d,t]=local.split('T'),[y,mo,da]=d.split('-').map(Number),[h,mi]=t.split(':').map(Number),target=Date.UTC(y,mo-1,da,h,mi);let utc=target;
 for(let i=0;i<2;i++){const parts=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(utc));const g=(k:string)=>Number(parts.find(p=>p.type===k)!.value);utc+=target-Date.UTC(g('year'),g('month')-1,g('day'),g('hour'),g('minute'));}
 return new Date(utc).toISOString();
}
