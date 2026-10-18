import {HttpException} from '@nestjs/common';
import {DB,audit} from './db.js';
import {Context,requirePermission,requireRecord} from './policy.js';
export async function lockRules(db:DB,workspace:string){const r=await db.query('SELECT * FROM assignment_rules WHERE workspace_id=$1 FOR UPDATE',[workspace]);if(!r.rows[0])throw new Error('Assignment rules missing');return r.rows[0];}
export async function routeLead(db:DB,workspace:string,lead:any,rules:any,reason:string,actor:string|null,forceOwner?:string){
 let candidates;
 if(forceOwner)candidates=await db.query(`SELECT m.* FROM memberships m WHERE m.workspace_id=$1 AND m.id=$2 AND m.active AND m.availability='Available' AND (SELECT count(*) FROM leads l WHERE l.workspace_id=$1 AND l.current_owner_id=m.id AND l.status<>'closed' AND l.id<>$3)<m.capacity FOR UPDATE`,[workspace,forceOwner,lead.id]);
 else candidates=await db.query(`SELECT m.* FROM memberships m WHERE m.workspace_id=$1 AND m.active AND m.availability='Available' AND m.id IS DISTINCT FROM $2::uuid AND (SELECT count(*) FROM leads l WHERE l.workspace_id=$1 AND l.current_owner_id=m.id AND l.status<>'closed')<m.capacity ORDER BY m.last_assigned_at NULLS FIRST,m.id LIMIT 1 FOR UPDATE`,[workspace,lead.current_owner_id]);
 if(forceOwner&&!candidates.rows[0])throw new HttpException('This employee is unavailable or at capacity.',409);
 let assignee=candidates.rows[0];
 const expired=reason==='escalation';const step=Number(lead.escalation_step)+(expired?1:0);
 const level=(await db.query('SELECT * FROM escalation_levels WHERE workspace_id=$1 AND step=$2',[workspace,step])).rows[0];
 if(expired&&level?.backup_member_id){const b=(await db.query(`SELECT m.* FROM memberships m WHERE m.workspace_id=$1 AND m.id=$2 AND m.active AND m.availability='Available' AND m.id IS DISTINCT FROM $3::uuid AND (SELECT count(*) FROM leads l WHERE l.workspace_id=$1 AND l.current_owner_id=m.id AND l.status<>'closed')<m.capacity FOR UPDATE`,[workspace,level.backup_member_id,lead.current_owner_id])).rows[0];if(b)assignee=b;}
 if(expired&&step>rules.max_escalations)assignee=undefined;// people get max_escalations chances; the next expiry goes to the manager
 const manager=(rules.manager_member_id?(await db.query('SELECT id FROM memberships WHERE workspace_id=$1 AND id=$2 AND active',[workspace,rules.manager_member_id])).rows[0]:undefined)||(await db.query("SELECT id FROM memberships WHERE workspace_id=$1 AND base_level='Owner' AND active ORDER BY id LIMIT 1",[workspace])).rows[0];if(!manager)throw new Error('Accountable manager missing');
 const owner=assignee?.id||null,accountable=owner||manager.id;
 const seconds=level?.seconds||rules.ack_seconds;
 const updated=(await db.query(`UPDATE leads SET current_owner_id=$2,accountable_member_id=$3,waiting_for_assignment=$4,first_assigned_at=CASE WHEN $2::uuid IS NOT NULL THEN COALESCE(first_assigned_at,now()) ELSE first_assigned_at END,assigned_at=CASE WHEN $2::uuid IS NOT NULL THEN now() ELSE assigned_at END,acknowledgment_deadline=CASE WHEN $2::uuid IS NULL THEN NULL ELSE now()+make_interval(secs=>$5::int) END,escalation_step=$6,escalation_count=escalation_count+$7,version=version+1 WHERE id=$1 AND workspace_id=$8 RETURNING *`,[lead.id,owner,accountable,!owner,seconds,step,expired?1:0,workspace])).rows[0];
 if(owner)await db.query('UPDATE memberships SET last_assigned_at=now() WHERE id=$1 AND workspace_id=$2',[owner,workspace]);
 await db.query('UPDATE contacts SET owner_id=$1,version=version+1 WHERE id=$2 AND workspace_id=$3',[accountable,lead.contact_id,workspace]);
 await db.query('UPDATE conversations SET owner_id=$1 WHERE workspace_id=$3 AND contact_id=$2',[accountable,lead.contact_id,workspace]);
 await db.query('INSERT INTO lead_assignments(workspace_id,lead_id,from_member_id,to_member_id,accountable_member_id,reason,lead_version) VALUES($1,$2,$3,$4,$5,$6,$7)',[workspace,lead.id,lead.current_owner_id,owner,accountable,reason,updated.version]);
 const leadName=(await db.query('SELECT name FROM contacts WHERE id=$1 AND workspace_id=$2',[lead.contact_id,workspace])).rows[0]?.name||'A lead';
 await db.query('INSERT INTO notifications(workspace_id,member_id,lead_id,kind,body) VALUES($1,$2,$3,$4,$5)',[workspace,accountable,lead.id,reason,owner?(expired?`${leadName} was escalated to you. Please acknowledge it.`:`${leadName} needs your acknowledgment.`):`${leadName} has no eligible assignee and needs manager recovery.`]);
 await db.query('INSERT INTO outbox_events(workspace_id,kind,payload,dedupe_key) VALUES($1,$2,$3,$4)',[workspace,expired||!owner?'lead.escalated':'lead.assigned',JSON.stringify({leadId:lead.id,memberId:accountable,version:updated.version,reason}),`assignment:${lead.id}:${updated.version}`]);
 await audit(db,workspace,actor,reason,lead.id,{owner:lead.current_owner_id,version:lead.version},{owner,accountable,version:updated.version});
 return updated;
}
export async function acknowledge(db:DB,ctx:Context,id:string,version:number){requirePermission(ctx,'crm.edit');await lockRules(db,ctx.workspaceId);const lead=(await db.query('SELECT * FROM leads WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[id,ctx.workspaceId])).rows[0];if(!lead)throw new HttpException('Record not found.',404);requireRecord(ctx,lead.accountable_member_id);if(lead.version!==version)throw new HttpException('This lead changed. Refresh before trying again.',409);if(lead.status!=='new')return lead;if(lead.current_owner_id!==ctx.memberId)throw new HttpException('Only the current assignee can acknowledge this lead. Reassign it first.',403);const result=(await db.query("UPDATE leads SET status='acknowledged',acknowledged_at=now(),last_activity_at=now(),acknowledgment_deadline=NULL,version=version+1 WHERE id=$1 AND workspace_id=$2 RETURNING *",[id,ctx.workspaceId])).rows[0];await audit(db,ctx.workspaceId,ctx.memberId,'acknowledged',id,{version},{version:result.version});return result;}
export async function processDeadlines(db:DB,workspace:string){const rules=await lockRules(db,workspace);const overdue=(await db.query("SELECT * FROM leads WHERE workspace_id=$1 AND status='new' AND NOT waiting_for_assignment AND acknowledgment_deadline<=now() ORDER BY acknowledgment_deadline LIMIT 50 FOR UPDATE",[workspace])).rows;for(const lead of overdue)await routeLead(db,workspace,lead,rules,'escalation',null);return overdue.length;}

/** A recorded action by the current assignee (stage change, appointment) counts as acknowledgement, like a note or message. */
export async function acknowledgeOnAction(db:DB,ctx:Context,contactId:string){
 const lead=(await db.query("SELECT * FROM leads WHERE workspace_id=$1 AND contact_id=$2 AND status='new' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[ctx.workspaceId,contactId])).rows[0];
 if(lead&&lead.current_owner_id===ctx.memberId)await acknowledge(db,ctx,lead.id,lead.version);
}
