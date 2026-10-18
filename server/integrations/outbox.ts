import {DB,transaction,pool} from '../db.js';
import {credentials,recordEvent,markResult,publicBase,getIntegration} from './registry.js';
import {sendEmail,DEFAULT_FROM} from './resend.js';
import {http} from './manage.js';
const MAX_ATTEMPTS=5;
const backoffSeconds=(attempt:number)=>Math.min(15*2**attempt,900);
const reasons:Record<string,string>={escalation:'the acknowledgment window expired',absence:'the previous owner became unavailable','no-assignee':'no eligible employee was available'};
/** Delivers pending outbox events (escalation alerts). Retries transient failures with backoff, then marks them failed for Admin review. */
export async function processOutbox(ws:string,fetchImpl=http){
 return transaction(ws,async db=>{
  const events=(await db.query("SELECT * FROM outbox_events WHERE workspace_id=$1 AND status='pending' AND available_at<=now() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED",[ws])).rows;
  for(const ev of events){
   if(ev.kind!=='lead.escalated'){await db.query("UPDATE outbox_events SET status='done' WHERE id=$1 AND workspace_id=$2",[ev.id,ws]);continue;}
   const r=await deliverEscalation(db,ws,ev.payload,fetchImpl);
   if(r.ok||r.permanent){await db.query("UPDATE outbox_events SET status=$3,attempts=attempts+1,last_error=$4 WHERE id=$1 AND workspace_id=$2",[ev.id,ws,r.ok?'done':'failed',r.ok?null:r.reason]);}
   else if(ev.attempts+1>=MAX_ATTEMPTS)await db.query("UPDATE outbox_events SET status='failed',attempts=attempts+1,last_error=$3 WHERE id=$1 AND workspace_id=$2",[ev.id,ws,r.reason]);
   else await db.query("UPDATE outbox_events SET attempts=attempts+1,last_error=$3,available_at=now()+make_interval(secs=>$4) WHERE id=$1 AND workspace_id=$2",[ev.id,ws,r.reason,backoffSeconds(ev.attempts)]);
  }
  return events.length;
 });
}
async function deliverEscalation(db:DB,ws:string,p:{leadId:string;memberId:string;reason:string;version?:number},fetchImpl:typeof http):Promise<{ok:true}|{ok:false;permanent:boolean;reason:string}>{
 const mail=await credentials(db,ws,'resend');if(!mail)return {ok:true};// channel not configured: in-app notification already exists
 const dest=(await db.query("SELECT COALESCE((SELECT address FROM notification_destinations WHERE workspace_id=$1 AND member_id=$2 AND provider='email'),u.email) AS address FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.id=$2 AND m.workspace_id=$1",[ws,p.memberId])).rows[0];
 if(!dest?.address)return {ok:true};
 const lead=(await db.query('SELECT l.id,l.source,l.version,c.name FROM leads l JOIN contacts c ON c.id=l.contact_id AND c.workspace_id=l.workspace_id WHERE l.id=$1 AND l.workspace_id=$2',[p.leadId,ws])).rows[0];if(!lead)return {ok:true};
 const link=`${publicBase()}/?lead=${lead.id}`;
 const text=`Lead escalated to you: ${lead.name}\nSource: ${lead.source}\nReason: ${reasons[p.reason]||p.reason}\nOpen: ${link}`;
 const r=await sendEmail(fetchImpl,{apiKey:mail.secrets.apiKey,from:mail.config.fromAddress||DEFAULT_FROM,to:dest.address,subject:`Lead escalated to you: ${lead.name}`,text,link,idempotencyKey:`escalation-${lead.id}-${p.memberId}-${p.version??lead.version}`});
 if(r.ok){await recordEvent(db,ws,mail.id,{direction:'out',type:'alert.email',summary:{leadId:lead.id,memberId:p.memberId}});await markResult(db,mail.id,ws,true);await db.query("INSERT INTO notifications(workspace_id,member_id,lead_id,kind,body) VALUES($1,$2,$3,'email',$4)",[ws,p.memberId,lead.id,`Escalation email for ${lead.name} was sent to ${dest.address}.`]);return {ok:true};}
 await recordEvent(db,ws,mail.id,{direction:'out',type:'alert.email',status:r.transient?'retrying':'failed',summary:{leadId:lead.id,memberId:p.memberId},error:r.reason});await markResult(db,mail.id,ws,false,r.reason);
 if(!r.transient)await db.query("INSERT INTO notifications(workspace_id,member_id,lead_id,kind,body) VALUES($1,$2,$3,'email_failed',$4)",[ws,p.memberId,lead.id,`Escalation email for ${lead.name} could not be sent: ${r.reason}`.slice(0,300)]);
 return {ok:false,permanent:!r.transient,reason:r.reason};
}
export async function outboxTick(){for(const w of (await pool.query('SELECT id FROM workspaces')).rows)await processOutbox(w.id);}
