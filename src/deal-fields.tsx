import React,{useState} from 'react';
import {api,errorText} from './api';

export type FieldDef={id:string;name:string;type:string;options?:string[];requiredStage?:string};
type Raw=string|boolean|undefined;

/** One input for a custom field, typed by the field definition. Value is submitted as `fv_<fieldId>`. */
export function FieldInput({field,value,disabled}:{field:FieldDef;value?:unknown;disabled?:boolean}){
 const name='fv_'+field.id,label=field.name+(field.requiredStage?` (required for ${field.requiredStage})`:'');
 if(field.type==='Checkbox')return <label className="check-row"><input type="checkbox" name={name} defaultChecked={value===true} disabled={disabled}/> {label}</label>;
 if(field.type==='Dropdown')return <label>{label}<select name={name} defaultValue={typeof value==='string'?value:''} disabled={disabled}><option value="">—</option>{(field.options||[]).map(o=><option key={o}>{o}</option>)}</select></label>;
 const t=field.type==='Number'?'number':field.type==='Date'?'date':'text';
 return <label>{label}<input name={name} type={t} step={t==='number'?'any':undefined} defaultValue={value===undefined||value===null?'':String(value)} disabled={disabled} maxLength={t==='text'?500:undefined}/></label>;
}

/** Reads the custom field values from a submitted form. Empty inputs are skipped so optional fields stay optional. */
export function readFieldValues(fields:FieldDef[],form:Record<string,Raw>,includeFalse=false):{id:string;value:string|number|boolean}[]{
 const out:{id:string;value:string|number|boolean}[]=[];
 for(const f of fields){
  const raw=form['fv_'+f.id];
  if(f.type==='Checkbox'){if(raw==='on'||raw===true)out.push({id:f.id,value:true});else if(includeFalse)out.push({id:f.id,value:false});continue;}
  if(raw===undefined||raw==='')continue;
  out.push({id:f.id,value:f.type==='Number'?Number(raw):String(raw)});
 }
 return out;
}

/** Saves values one by one, tracking the opportunity version the server returns after each write. */
export async function saveFieldValues(opportunityId:string,version:number,values:{id:string;value:unknown}[]){
 let v=version;for(const x of values){const r=await api('PUT',`/opportunities/${opportunityId}/fields/${x.id}`,{version:v,value:x.value});v=r.version;}
 return v;
}

/** Editable list of an opportunity's custom fields on its detail view. */
export function DealFields({deal,fields,canEdit,onSaved,notify}:{deal:{id:string;version?:number;fields?:Record<string,unknown>};fields:FieldDef[];canEdit:boolean;onSaved:()=>Promise<unknown>|void;notify:(t:string,e?:boolean)=>void}){
 const [busy,setBusy]=useState(false);
 if(!fields.length)return null;
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const form=Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string,Raw>;
  const changed=readFieldValues(fields,form,true).filter(x=>(deal.fields?.[x.id]??(x.value===false?false:undefined))!==x.value);
  if(!changed.length){notify('Nothing to save.');return;}
  setBusy(true);try{await saveFieldValues(deal.id,deal.version||1,changed);await onSaved();notify('Fields saved.');}catch(err){notify(errorText(err),true);}finally{setBusy(false);}
 }
 return <form className="deal-fields" onSubmit={submit} key={deal.id+':'+deal.version}>
  <h4>Custom fields</h4>
  {fields.map(f=><FieldInput key={f.id} field={f} value={deal.fields?.[f.id]} disabled={!canEdit||busy}/>)}
  {canEdit&&<button className="btn" disabled={busy}>{busy?'Saving…':'Save fields'}</button>}
 </form>;
}
