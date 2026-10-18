import React,{useCallback,useEffect,useState} from 'react';
import {Activity,LockKeyhole} from 'lucide-react';
import {api,errorText} from './api';
type Row={id:string;event:string;actor_name:string|null;target_id:string|null;before_state:unknown;after_state:unknown;created_at:string};
const brief=(v:unknown)=>v==null?'':JSON.stringify(v).slice(0,160);
/** Read-only audit history with server-side filters (event type, user, date range). */
export function AuditPage({team,notify}:{team:{id:string;name:string}[];notify:(t:string,e?:boolean)=>void}){
 const [rows,setRows]=useState<Row[]>([]),[types,setTypes]=useState<string[]>([]),[f,setF]=useState({event:'',actor:'',from:'',to:''}),[loading,setLoading]=useState(true),[more,setMore]=useState(false);
 const load=useCallback(async(offset=0)=>{setLoading(true);try{const q=new URLSearchParams({limit:'50',offset:String(offset)});for(const [k,v] of Object.entries(f))if(v)q.set(k,v);const r=await api('GET','/audit?'+q);setTypes(r.eventTypes);setMore(r.records.length===50);setRows(offset?prev=>[...prev,...r.records]:r.records)}catch(e){notify(errorText(e),true)}finally{setLoading(false)}},[f]);
 useEffect(()=>{load(0)},[load]);
 return <section className="panel"><div className="records-controls" style={{flexWrap:'wrap',gap:8}}>
  <label>Event<select value={f.event} onChange={e=>setF({...f,event:e.target.value})}><option value="">All events</option>{types.map(t=><option key={t}>{t}</option>)}</select></label>
  <label>User<select value={f.actor} onChange={e=>setF({...f,actor:e.target.value})}><option value="">Everyone</option>{team.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  <label>From<input type="date" value={f.from} onChange={e=>setF({...f,from:e.target.value})}/></label>
  <label>To<input type="date" value={f.to} onChange={e=>setF({...f,to:e.target.value})}/></label>
  <span className="inline muted"><LockKeyhole size={13}/>Read-only history</span></div>
  <div className="audit-list" aria-busy={loading}>{rows.map(r=><div className="audit-row" key={r.id}><span className="event-icon"><Activity size={16}/></span><div><strong>{r.event}</strong><span>{r.actor_name||'System'} <i>·</i> {new Date(r.created_at).toLocaleString()}</span>{(r.before_state!=null||r.after_state!=null)&&<small style={{display:'block',wordBreak:'break-word'}}>{r.before_state!=null?`Before: ${brief(r.before_state)} `:''}{r.after_state!=null?`After: ${brief(r.after_state)}`:''}</small>}</div></div>)}
   {!loading&&!rows.length&&<p className="field-help" style={{padding:16}}>No history matches these filters.</p>}</div>
  {more&&<div style={{padding:16}}><button className="btn" disabled={loading} onClick={()=>load(rows.length)}>Load more</button></div>}
 </section>;
}
