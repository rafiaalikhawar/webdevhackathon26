import React,{useState} from 'react';
import {Plus,Trash2,TriangleAlert} from 'lucide-react';
import {api,errorText} from './api';
type Member={id:string;name:string;email:string;baseLevel?:string;roleIds?:string[]};
type Role={id:string;name:string;permissions:string[]};
const PERMS:[string,string][]=[['crm.view','View own records'],['crm.view_all','View all records'],['crm.create','Create records'],['crm.edit','Edit records'],['crm.delete','Delete / archive'],['crm.export','Export'],['opportunity.value','See opportunity values'],['assignment.manage','Manage assignment rules'],['integration.manage','Manage integrations'],['audit.view','View audit log'],['config.manage','Manage pipelines & fields'],['workspace.manage','Manage workspace']];
type Props={canManage:boolean;isOwner:boolean;run:(fn:()=>Promise<unknown>,ok:string)=>Promise<boolean>;notify:(t:string,e?:boolean)=>void};

/** Roles are permission sets. Owner is always all-powerful; Admin and User levels get extra permissions from assigned roles. */
export function RolesEditor({roles,team,canManage,isOwner,run}:Props&{roles:Role[];team:Member[]}){
 const [name,setName]=useState(''),[sel,setSel]=useState<string[]>(['crm.view']);
 return <div className="settings-body">
  <div className="notice compact"><TriangleAlert size={17}/>Owner always has every permission. A Manager is simply a role you define here. Permissions are enforced on the server.</div>
  <h3>Roles</h3>
  {roles.map(r=><RoleCard key={r.id} role={r} canManage={canManage} run={run}/>)}
  {!roles.length&&<p className="field-help">No custom roles yet.</p>}
  {canManage&&<form onSubmit={e=>{e.preventDefault();run(async()=>{await api('POST','/roles',{name,permissions:sel});setName('')},'Role created.')}} style={{display:'grid',gap:8,marginTop:12}}>
   <h3>New role</h3><label>Role name<input value={name} onChange={e=>setName(e.target.value)} required maxLength={80} placeholder="e.g. Manager"/></label>
   <fieldset style={{border:0,padding:0,display:'grid',gap:4}}><legend>Permissions</legend>{PERMS.map(([c,l])=><label key={c} className="toggle-row">{l}<input type="checkbox" checked={sel.includes(c)} onChange={e=>setSel(e.target.checked?[...sel,c]:sel.filter(x=>x!==c))}/></label>)}</fieldset>
   <button className="btn primary"><Plus size={14}/>Create role</button></form>}
  <h3 style={{marginTop:20}}>Team access</h3>
  <div className="table-wrap"><table><thead><tr><th>Member</th><th>Level</th><th>Roles</th></tr></thead><tbody>{team.map(m=><tr key={m.id}><td><strong>{m.name}</strong><small style={{display:'block'}}>{m.email}</small></td>
   <td>{m.baseLevel==='Owner'||!isOwner?m.baseLevel:<select aria-label={`${m.name} access level`} value={m.baseLevel} onChange={e=>run(()=>api('PATCH',`/team/${m.id}/level`,{baseLevel:e.target.value}),'Access level updated.')}><option>Admin</option><option>User</option></select>}</td>
   <td>{m.baseLevel==='Owner'?'All permissions':roles.length?roles.map(r=><label key={r.id} style={{display:'inline-flex',gap:4,marginRight:10}}><input type="checkbox" disabled={!canManage} checked={(m.roleIds||[]).includes(r.id)} onChange={e=>run(()=>api('PUT',`/team/${m.id}/roles`,{roleIds:e.target.checked?[...(m.roleIds||[]),r.id]:(m.roleIds||[]).filter(x=>x!==r.id)}),'Roles updated.')}/>{r.name}</label>):<span className="muted">No roles defined</span>}</td></tr>)}</tbody></table></div>
 </div>;
}
function RoleCard({role,canManage,run}:{role:Role;canManage:boolean;run:Props['run']}){
 const [sel,setSel]=useState(role.permissions),[open,setOpen]=useState(false);
 return <div className="panel" style={{padding:12,marginBottom:8}}><div className="split"><strong>{role.name}</strong><span className="muted">{role.permissions.length} permissions</span><button className="btn" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'Close':'Edit'}</button>{canManage&&<button className="icon-btn" aria-label={`Delete ${role.name}`} onClick={()=>{if(confirm(`Delete role “${role.name}”? Members lose its permissions.`))run(()=>api('DELETE','/roles/'+role.id),'Role deleted.')}}><Trash2 size={14}/></button>}</div>
  {open&&<div style={{display:'grid',gap:4,marginTop:8}}>{PERMS.map(([c,l])=><label key={c} className="toggle-row">{l}<input type="checkbox" disabled={!canManage} checked={sel.includes(c)} onChange={e=>setSel(e.target.checked?[...sel,c]:sel.filter(x=>x!==c))}/></label>)}{canManage&&<button className="btn primary" onClick={()=>run(()=>api('PUT','/roles/'+role.id,{permissions:sel}),'Role saved.')}>Save role</button>}</div>}</div>;
}

type Level={seconds:number;backupMemberId:string|null};
/** Escalation chain: step N is used when the N-th acknowledgment window expires. Optional designated backup per step; the Owner is the final fallback. */
export function EscalationEditor({initial,team,ackSeconds,canEdit,run}:{initial:{step:number;seconds:number;backup_member_id:string|null}[];team:Member[];ackSeconds:number;canEdit:boolean;run:Props['run']}){
 const [levels,setLevels]=useState<Level[]>(initial.map(l=>({seconds:l.seconds,backupMemberId:l.backup_member_id})));
 const set=(i:number,p:Partial<Level>)=>setLevels(levels.map((l,j)=>j===i?{...l,...p}:l));
 return <div style={{margin:'16px 0'}}><h3>Escalation chain</h3>
  <p className="field-help">Level 0 is the assigned employee ({ackSeconds}s to acknowledge). Each level below applies after the previous window expires. When every level is used, the lead goes to the Owner for recovery.</p>
  {levels.map((l,i)=><div className="stage-setting" key={i} style={{gap:8,flexWrap:'wrap'}}><strong>Level {i+1}</strong>
   <label>Seconds<input type="number" min={10} max={86400} value={l.seconds} disabled={!canEdit} onChange={e=>set(i,{seconds:Number(e.target.value)})} style={{width:90}}/></label>
   <label>Designated backup<select value={l.backupMemberId||''} disabled={!canEdit} onChange={e=>set(i,{backupMemberId:e.target.value||null})}><option value="">Next available employee</option>{team.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   {canEdit&&<button type="button" className="icon-btn" aria-label={`Remove level ${i+1}`} onClick={()=>setLevels(levels.filter((_,j)=>j!==i))}><Trash2 size={14}/></button>}</div>)}
  {canEdit&&<div style={{display:'flex',gap:8,marginTop:8}}><button type="button" className="btn" disabled={levels.length>=10} onClick={()=>setLevels([...levels,{seconds:ackSeconds,backupMemberId:null}])}><Plus size={14}/>Add level</button><button type="button" className="btn primary" onClick={()=>run(()=>api('PUT','/escalation-levels',{levels}),'Escalation chain saved.')}>Save chain</button></div>}
  {levels.some(l=>l.seconds<10)&&<div className="form-error" role="alert">Each level needs at least 10 seconds.</div>}
 </div>;
}
