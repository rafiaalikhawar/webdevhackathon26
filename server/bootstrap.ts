import {DB} from './db.js';
import {Context} from './policy.js';

const colors=['purple','blue','green','amber','rose'];
const initialsOf=(s:string)=>s.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase();
const titleCase=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);
const paymentLabel:Record<string,string>={pending:'Pending',paid:'Paid',failed:'Failed',expired:'Expired',refunded:'Refunded',partially_refunded:'Partially refunded'};

/** One permission-aware snapshot shaped for the web client. All reads happen inside the caller's workspace transaction. */
export async function buildBootstrap(db:DB,ctx:Context){
 const w=ctx.workspaceId,all=ctx.permissions.has('crm.view_all'),values=ctx.permissions.has('opportunity.value');
 const q=async(sql:string,p:any[]=[])=>(await db.query(sql,[w,...p])).rows;
 const [ws]=await q('SELECT name,currency,timezone FROM workspaces WHERE id=$1');
 const [rules]=await q('SELECT * FROM assignment_rules WHERE workspace_id=$1');
 const members=await q(`SELECT m.id,m.base_level,m.availability,m.capacity,u.name,u.email,
   COALESCE((SELECT array_agg(mr.role_id) FROM membership_roles mr WHERE mr.membership_id=m.id AND mr.workspace_id=m.workspace_id),'{}') AS role_ids,
   COALESCE((SELECT string_agg(r.name,', ') FROM membership_roles mr JOIN roles r ON r.id=mr.role_id AND r.workspace_id=mr.workspace_id WHERE mr.membership_id=m.id AND mr.workspace_id=m.workspace_id),'') AS roles,
   (SELECT count(*) FROM leads l WHERE l.workspace_id=m.workspace_id AND l.current_owner_id=m.id AND l.status<>'closed')::int AS open_leads
   FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.active ORDER BY m.base_level='Owner' DESC,u.name`);
 const leadRows=await q(`SELECT l.*,c.name,c.email,c.phone,c.opted_out,co.name AS company,
   COALESCE((SELECT sum(o.value_minor) FROM opportunities o WHERE o.workspace_id=l.workspace_id AND o.contact_id=l.contact_id AND o.archived_at IS NULL),0)::bigint AS value_minor
   FROM leads l JOIN contacts c ON c.id=l.contact_id AND c.workspace_id=l.workspace_id JOIN companies co ON co.id=c.company_id AND co.workspace_id=c.workspace_id
   WHERE l.workspace_id=$1 AND c.archived_at IS NULL AND ($2::boolean OR l.accountable_member_id=$3) ORDER BY l.created_at DESC LIMIT 500`,[all,ctx.memberId]);
 const leadByContact=new Map<string,string>();for(const l of leadRows)if(!leadByContact.has(l.contact_id))leadByContact.set(l.contact_id,l.id);
 const contactIds=leadRows.map(l=>l.contact_id);
 const pipelines=await q('SELECT * FROM pipelines WHERE workspace_id=$1 ORDER BY name');
 const stageRows=await q('SELECT * FROM stages WHERE workspace_id=$1 ORDER BY pipeline_id,position');
 const fields=await q('SELECT f.*,(SELECT s.name FROM stage_required_fields r JOIN stages s ON s.id=r.stage_id AND s.workspace_id=r.workspace_id WHERE r.field_id=f.id AND r.workspace_id=f.workspace_id LIMIT 1) AS required_stage FROM custom_fields f WHERE f.workspace_id=$1 AND f.archived_at IS NULL');
 const dealRows=await q(`SELECT o.*,s.name AS stage_name,s.kind AS stage_kind,p.name AS pipeline_name,co.name AS company FROM opportunities o
   JOIN stages s ON s.id=o.stage_id AND s.workspace_id=o.workspace_id JOIN pipelines p ON p.id=o.pipeline_id AND p.workspace_id=o.workspace_id
   JOIN contacts c ON c.id=o.contact_id AND c.workspace_id=o.workspace_id JOIN companies co ON co.id=c.company_id AND co.workspace_id=c.workspace_id
   WHERE o.workspace_id=$1 AND o.archived_at IS NULL AND ($2::boolean OR o.owner_id=$3) ORDER BY o.close_date NULLS LAST LIMIT 500`,[all,ctx.memberId]);
 const fieldVals=dealRows.length?await q('SELECT opportunity_id,field_id,value FROM custom_field_values WHERE workspace_id=$1 AND opportunity_id=ANY($2::uuid[])',[dealRows.map((d:any)=>d.id)]):[];
 const activities=contactIds.length?await q('SELECT a.*,u.name AS actor_name FROM activities a LEFT JOIN memberships m ON m.id=a.actor_id AND m.workspace_id=a.workspace_id LEFT JOIN users u ON u.id=m.user_id WHERE a.workspace_id=$1 AND a.contact_id=ANY($2::uuid[]) ORDER BY a.created_at DESC LIMIT 400',[contactIds]):[];
 const assignments=contactIds.length?await q('SELECT la.*,u.name AS to_name FROM lead_assignments la LEFT JOIN memberships m ON m.id=la.accountable_member_id AND m.workspace_id=la.workspace_id LEFT JOIN users u ON u.id=m.user_id WHERE la.workspace_id=$1 AND la.lead_id=ANY($2::uuid[]) ORDER BY la.assigned_at DESC LIMIT 400',[leadRows.map(l=>l.id)]):[];
 const audit=ctx.permissions.has('audit.view')?await q('SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN memberships m ON m.id=a.actor_id AND m.workspace_id=a.workspace_id LEFT JOIN users u ON u.id=m.user_id WHERE a.workspace_id=$1 ORDER BY a.created_at DESC LIMIT 200'):[];
 const convs=contactIds.length?await q('SELECT * FROM conversations WHERE workspace_id=$1 AND contact_id=ANY($2::uuid[])',[contactIds]):[];
 const msgs=convs.length?await q('SELECT * FROM messages WHERE workspace_id=$1 AND conversation_id=ANY($2::uuid[]) ORDER BY created_at',[convs.map(c=>c.id)]):[];
 const appts=await q('SELECT * FROM appointments WHERE workspace_id=$1 AND ($2::boolean OR employee_id=$3) ORDER BY starts_at DESC LIMIT 200',[all,ctx.memberId]);
 const pays=await q('SELECT p.*,o.contact_id,(SELECT COALESCE(sum(amount_minor),0) FROM refunds r WHERE r.payment_id=p.id AND r.workspace_id=p.workspace_id AND r.confirmed_at IS NOT NULL)::bigint AS refunded_minor FROM payments p JOIN opportunities o ON o.id=p.opportunity_id AND o.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND ($2::boolean OR p.requested_by=$3) ORDER BY p.created_at DESC LIMIT 200',[all,ctx.memberId]);
 const [prefs]=await q('SELECT visible_metrics FROM dashboard_preferences WHERE workspace_id=$1 AND member_id=$2',[ctx.memberId]);
 const saved=await q('SELECT id,name,filter FROM saved_filters WHERE workspace_id=$1 AND member_id=$2 ORDER BY name',[ctx.memberId]);
 const levels=await q('SELECT step,seconds,backup_member_id FROM escalation_levels WHERE workspace_id=$1 ORDER BY step');
 const roles=await q("SELECT r.id,r.name,COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),'{}') AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id AND rp.workspace_id=r.workspace_id WHERE r.workspace_id=$1 GROUP BY r.id ORDER BY r.name");
 const integrations=ctx.permissions.has('integration.manage')?await q('SELECT provider,status,last_success_at FROM integrations WHERE workspace_id=$1 AND member_id IS NULL'):[];
 const [dest]=await q("SELECT address FROM notification_destinations WHERE workspace_id=$1 AND member_id=$2 AND provider='email'",[ctx.memberId]);
 const calendarRows=await q("SELECT member_id,status FROM integrations WHERE workspace_id=$1 AND provider='google' AND member_id IS NOT NULL AND ($2::boolean OR member_id=$3)",[ctx.permissions.has('integration.manage'),ctx.memberId]);
 const providerRows=await q('SELECT provider,status FROM integrations WHERE workspace_id=$1 AND member_id IS NULL');
 const notifications=await q('SELECT n.id,n.lead_id,n.kind,n.body,n.created_at,n.read_at,c.name AS lead_name FROM notifications n LEFT JOIN leads l ON l.id=n.lead_id AND l.workspace_id=n.workspace_id LEFT JOIN contacts c ON c.id=l.contact_id AND c.workspace_id=l.workspace_id WHERE n.workspace_id=$1 AND n.member_id=$2 ORDER BY n.created_at DESC LIMIT 100',[ctx.memberId]);

 const primary=pipelines[0];
 const stages=stageRows.filter(s=>s.pipeline_id===primary?.id);
 const memberName=(id:string)=>members.find(m=>m.id===id)?.name||'System';
 const events=[
  ...activities.map(a=>({id:a.id,leadId:leadByContact.get(a.contact_id),kind:a.kind,text:a.body,actor:a.actor_name||'System',at:a.created_at})),
  ...assignments.map(a=>({id:a.id,leadId:a.lead_id,kind:a.reason==='escalation'?'escalation':'assigned',text:a.reason==='escalation'?`Lead escalated to ${a.to_name||'a manager'} after the acknowledgment window expired.`:`Lead assigned to ${a.to_name||'a manager'} (${a.reason}).`,actor:'System',at:a.assigned_at})),
  ...audit.map(a=>({id:'audit-'+a.id,kind:'audit',text:`${a.event}${a.before_state||a.after_state?' · '+JSON.stringify(a.after_state??a.before_state).slice(0,140):''}`,actor:a.actor_name||'System',at:a.created_at,event:a.event}))
 ].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));

 return {
  me:{memberId:ctx.memberId,baseLevel:ctx.baseLevel,permissions:[...ctx.permissions]},
  meta:{workspaceId:w,pipelineId:primary?.id||null,pipelines:pipelines.map(p=>({id:p.id,name:p.name})),stageIds:Object.fromEntries(stages.map(s=>[s.name,s.id])),stageKinds:Object.fromEntries(stages.map(s=>[s.name,s.kind])),rulesVersion:rules?.version||1,maxEscalations:rules?.max_escalations||3,escalationLevels:levels,roles,saved,integrations,notifications,destination:dest?.address||'',providers:Object.fromEntries(providerRows.map(r=>[r.provider,r.status])),calendar:calendarRows.map(r=>({memberId:r.member_id,status:r.status})),fields:fields.map(f=>({id:f.id,pipelineId:f.pipeline_id,name:f.name,type:f.type,options:f.options})),pipelineList:pipelines.map(p=>({id:p.id,name:p.name,stages:stageRows.filter(s=>s.pipeline_id===p.id).map(s=>({id:s.id,name:s.name,kind:s.kind})),fields:fields.filter(f=>f.pipeline_id===p.id).map(f=>({id:f.id,name:f.name,type:titleCase(f.type),options:f.options,requiredStage:f.required_stage||''}))}))},
  data:{
   team:members.map((m,i)=>({id:m.id,name:m.name,initials:initialsOf(m.name),role:m.roles||(m.base_level==='User'?'Sales':m.base_level),status:m.availability,capacity:m.capacity,color:colors[i%colors.length],email:m.email,baseLevel:m.base_level,openLeads:m.open_leads,roleIds:m.role_ids})),
   leads:leadRows.map(l=>({id:l.id,contactId:l.contact_id,name:l.name,company:l.company,email:l.email||'',phone:l.phone||'',optedOut:l.opted_out,source:l.source,owner:l.current_owner_id||l.accountable_member_id,status:titleCase(l.status),createdAt:l.created_at,deadline:l.acknowledgment_deadline||l.created_at,acknowledgedAt:l.acknowledged_at||undefined,firstAssignedAt:l.first_assigned_at||l.created_at,escalations:l.escalation_count,lastActivity:l.last_activity_at,version:l.version,waiting:l.waiting_for_assignment,value:values?Number(l.value_minor)/100:0,tags:[]})),
   deals:dealRows.map(d=>({id:d.id,name:d.name,company:d.company,contactId:leadByContact.get(d.contact_id)||d.contact_id,stage:d.stage_name,value:values?Number(d.value_minor)/100:0,owner:d.owner_id,closeDate:d.close_date?(d.close_date instanceof Date?d.close_date.toLocaleDateString('en-CA'):String(d.close_date).slice(0,10)):'',pipeline:d.pipeline_name,pipelineId:d.pipeline_id,currency:d.currency,fields:Object.fromEntries(fieldVals.filter((v:any)=>v.opportunity_id===d.id).map((v:any)=>[v.field_id,v.value])),nextStep:d.next_step||'',version:d.version})),
   stages:stages.map(s=>s.name),events,
   meetings:appts.map(a=>({id:a.id,title:a.title,contactId:leadByContact.get(a.contact_id)||a.contact_id,owner:a.employee_id,at:a.starts_at,duration:Math.round((Date.parse(a.ends_at)-Date.parse(a.starts_at))/60000),timezone:a.timezone,status:titleCase(a.status)})),
   chats:convs.map(c=>({id:c.id,leadId:leadByContact.get(c.contact_id)||'',channel:c.channel,messages:msgs.filter(m=>m.conversation_id===c.id).map(m=>({id:m.id,text:m.body,direction:m.direction,at:m.created_at,status:titleCase(m.status),error:m.status==='failed'?m.error_code||'':''}))})),
   payments:pays.map(p=>({id:p.id,leadId:leadByContact.get(p.contact_id)||'',dealId:p.opportunity_id,amount:values?(Number(p.amount_minor)-Number(p.refunded_minor))/100:0,status:paymentLabel[p.status]||p.status,at:p.confirmed_at||p.created_at,ref:p.provider_reference||'',requestedBy:p.requested_by,currency:p.currency,total:values?Number(p.amount_minor)/100:0,refunded:values?Number(p.refunded_minor)/100:0,url:p.status==='pending'?p.checkout_url||'':''})),
   settings:{ackSeconds:rules?.ack_seconds||600,idleHours:Math.round((rules?.idle_seconds||86400)/3600),maxLeads:members[0]?.capacity||8,workspace:ws?.name||'',currency:ws?.currency||'USD',managerId:rules?.manager_member_id||''},
   customFields:fields.filter(f=>f.pipeline_id===primary?.id).map(f=>({id:f.id,name:f.name,type:titleCase(f.type),requiredStage:f.required_stage||''})),
   visibleMetrics:prefs?.visible_metrics||['leads','value','response','revenue']
  }
 };
}
