// Live HTTP checks against a running API + PostgreSQL. Run: npm run test:http
import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.API||'http://localhost:3001/api',origin='http://localhost:5173';
class Client{cookies:Record<string,string>={};csrf='';ws='';
 async call(method:string,path:string,body?:unknown,headers:Record<string,string>={}){const h:Record<string,string>={Origin:origin,'Content-Type':'application/json',Cookie:Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join('; ')};if(this.ws)h['X-Workspace-Id']=this.ws;if(this.csrf)h['X-CSRF-Token']=this.csrf;Object.assign(h,headers);const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}).catch((e:any)=>{throw new Error(`${method} ${path}: ${e.cause?.message||e.message}`)});for(const c of r.headers.getSetCookie())this.cookies[c.split('=')[0]]=c.split(';')[0].split('=')[1];const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};}
 async signup(workspace:string){const email=`${crypto.randomUUID().slice(0,8)}@e2e.test`;const r=await this.call('POST','/auth/signup',{email,password:'correct-horse-battery',name:'Owner '+workspace,workspace});assert.equal(r.status,201);this.csrf=r.body.csrf;this.ws=r.body.workspace.id;return {email,...r.body};}}
test('workspace isolation, permissions and lead flow over HTTP',async()=>{
 const a=new Client(),b=new Client();const A=await a.signup('A'),B=await b.signup('B');
 const boot=await a.call('GET','/bootstrap');assert.equal(boot.status,200);assert.equal(boot.body.data.stages.length,6);
 const lead=await a.call('POST','/leads',{name:'Emma Brooks',company:'Meridian',email:'emma@example.com',source:'Manual'});assert.equal(lead.status,201);
 const list=await a.call('GET','/leads');assert.equal(list.body.total,1);
 // B cannot see A's lead, even with A's ids or by guessing the workspace header.
 assert.equal((await b.call('GET','/leads')).body.total,0);
 b.ws=A.workspace.id;const cross=await b.call('GET','/leads');assert.ok([401,403,404].includes(cross.status),'cross-workspace read must fail, got '+cross.status);b.ws=B.workspace.id;
 const detail=await b.call('GET','/contacts/'+list.body.records[0].contact_id);assert.equal(detail.status,404);
 // Missing CSRF / bad origin are rejected.
 const noCsrf=await a.call('POST','/leads',{name:'x',company:'y'},{'X-CSRF-Token':'bad'});assert.ok(noCsrf.status>=400);
 const badOrigin=await a.call('POST','/leads',{name:'x',company:'y'},{Origin:'http://evil.test'});assert.equal(badOrigin.status,403);
 // Owner is the only assignee, so the lead is acknowledged by the owner.
 const rec=list.body.records[0];const ack=await a.call('POST',`/leads/${rec.id}/acknowledge`,{version:rec.version});assert.equal(ack.status,201);
 const stale=await a.call('POST',`/leads/${rec.id}/acknowledge`,{version:rec.version});assert.ok(stale.status===409||stale.status===201);
 // Stages
 const stage=await a.call('POST','/stages',{pipelineId:boot.body.meta.pipelineId,name:'Contract'});assert.equal(stage.status,201);
 const dup=await a.call('POST','/stages',{pipelineId:boot.body.meta.pipelineId,name:'contract'});assert.equal(dup.status,409);
 const b2=await a.call('GET','/bootstrap');assert.deepEqual(b2.body.data.stages.slice(-3),['Contract','Won','Lost']);
 // Web form captures a lead with the Website source.
 const form=await new Client().call('POST','/public/leads/'+A.workspace.id,{name:'Web Visitor',email:'visitor@example.com',message:'Hi'});assert.equal(form.status,201);
 const after=await a.call('GET','/leads');assert.equal(after.body.total,2);
 // Invitation → accept → limited User cannot manage workspace.
 const invitee=`user-${crypto.randomUUID().slice(0,8)}@e2e.test`;const inv=await a.call('POST','/invitations',{email:invitee,baseLevel:'User'});assert.equal(inv.status,201);
 const token=new URL(inv.body.link).searchParams.get('invite')!;
 const u=new Client();const acc=await u.call('POST','/public/accept-invite',{token,workspaceId:A.workspace.id,email:invitee,password:'correct-horse-battery',name:'User One'});assert.equal(acc.status,201);u.csrf=acc.body.csrf;u.ws=A.workspace.id;
 assert.equal((await u.call('POST','/stages',{pipelineId:boot.body.meta.pipelineId,name:'Nope'})).status,403);
 assert.equal((await u.call('GET','/audit')).status,403);
 // Audit log is append-only and has entries.
 const audit=await a.call('GET','/audit');assert.ok(audit.body.records.length>3);
});

test('roles, escalation chain, second pipeline, audit filters and live events',async()=>{
 const a=new Client();const A=await a.signup('R');const boot=await a.call('GET','/bootstrap');
 // Roles: create, edit, assign; a member with a role gets exactly its permissions.
 const role=await a.call('POST','/roles',{name:'Manager',permissions:['crm.view','crm.view_all','audit.view']});assert.equal(role.status,201);
 assert.equal((await a.call('PUT','/roles/'+role.body.id,{permissions:['crm.view','crm.view_all','audit.view','assignment.manage']})).status,200);
 const invitee=`mgr-${crypto.randomUUID().slice(0,8)}@e2e.test`;const inv=await a.call('POST','/invitations',{email:invitee,baseLevel:'User'});
 const m=new Client();const acc=await m.call('POST','/public/accept-invite',{token:new URL(inv.body.link).searchParams.get('invite')!,workspaceId:A.workspace.id,email:invitee,password:'correct-horse-battery',name:'Mia Manager'});assert.equal(acc.status,201);m.csrf=acc.body.csrf;m.ws=A.workspace.id;
 assert.equal((await m.call('GET','/audit')).status,403,'no role yet');
 const memberId=(await a.call('GET','/bootstrap')).body.data.team.find((t:any)=>t.name==='Mia Manager').id;
 assert.equal((await a.call('PUT',`/team/${memberId}/roles`,{roleIds:[role.body.id]})).status,200);
 assert.equal((await m.call('GET','/audit')).status,200,'role grants audit view');
 assert.equal((await m.call('POST','/roles',{name:'x',permissions:[]})).status,403,'workspace.manage is not granted');
 assert.equal((await m.call('PATCH',`/team/${memberId}/level`,{baseLevel:'Admin'})).status,403,'only the Owner changes levels');
 assert.equal((await a.call('PATCH',`/team/${memberId}/level`,{baseLevel:'Admin'})).status,200);
 // Escalation chain
 assert.equal((await a.call('PUT','/escalation-levels',{levels:[{seconds:30,backupMemberId:memberId},{seconds:60}]})).status,200);
 assert.equal((await a.call('GET','/bootstrap')).body.meta.escalationLevels.length,2);
 assert.equal((await a.call('PUT','/escalation-levels',{levels:[{seconds:1}]})).status,400,'window below 10s is rejected');
 // Second pipeline has its own stages and fields while sharing contacts.
 const p2=await a.call('POST','/pipelines',{name:'Partnerships'});assert.equal(p2.status,201);
 assert.equal((await a.call('POST','/pipelines',{name:'Partnerships'})).status,409);
 const f1=await a.call('POST','/custom-fields',{pipelineId:p2.body.id,name:'Partner tier',type:'dropdown',options:['Gold','Silver']});assert.equal(f1.status,201);
 const b2=(await a.call('GET','/bootstrap')).body.meta.pipelineList;assert.equal(b2.length,2);
 assert.deepEqual(b2.find((p:any)=>p.name==='Sales pipeline').fields,[]);assert.equal(b2.find((p:any)=>p.name==='Partnerships').fields[0].name,'Partner tier');
 const st=b2.find((p:any)=>p.name==='Partnerships').stages;assert.deepEqual(st.map((s:any)=>s.name),['New','In progress','Won','Lost']);
 // Stage reorder keeps terminal stages last.
 const ps=await a.call('POST','/stages',{pipelineId:p2.body.id,name:'Review'});assert.equal(ps.status,201);
 assert.equal((await a.call('PATCH','/stages/'+ps.body.id,{position:0})).status,200);
 const re=(await a.call('GET','/bootstrap')).body.meta.pipelineList.find((p:any)=>p.name==='Partnerships').stages.map((s:any)=>s.name);assert.deepEqual(re,['Review','New','In progress','Won','Lost']);
 // Audit filters
 const all=await a.call('GET','/audit');assert.ok(all.body.records.length>5);assert.ok(all.body.eventTypes.includes('role.created'));
 const only=await a.call('GET','/audit?event=role.created');assert.ok(only.body.records.length===1&&only.body.records.every((r:any)=>r.event==='role.created'));
 assert.equal((await a.call('GET','/audit?from=2999-01-01')).body.records.length,0);
 assert.equal((await a.call('DELETE','/audit/'+all.body.records[0].id)).status,404,'no endpoint deletes history');
 // Server-sent events: a change in the workspace is pushed to a connected client.
 const ctl=new AbortController();const res=await fetch(`${base}/events?ws=${A.workspace.id}`,{headers:{Origin:origin,Cookie:Object.entries(a.cookies).map(([k,v])=>`${k}=${v}`).join('; ')},signal:ctl.signal});assert.equal(res.status,200);
 const reader=res.body!.getReader();let got=false;const pump=(async()=>{const dec=new TextDecoder();for(;;){const {value,done}=await reader.read();if(done)break;if(dec.decode(value).includes('event: change')){got=true;break}}})().catch(()=>{});
 await new Promise(r=>setTimeout(r,2500));await a.call('POST','/leads',{name:'Live Push',company:'Co',source:'Manual'});
 for(let i=0;i<20&&!got;i++)await new Promise(r=>setTimeout(r,500));ctl.abort();await pump;assert.ok(got,'change event was pushed');
 // The stream refuses unauthenticated clients.
 assert.equal((await fetch(`${base}/events?ws=${A.workspace.id}`)).status,401);
});

test('Admin configures the CRM; custom field values reach opportunities; Users cannot configure',async()=>{
 const a=new Client();const A=await a.signup('Cfg');
 const join=async(level:'Admin'|'User')=>{const email=`${level.toLowerCase()}-${crypto.randomUUID().slice(0,8)}@e2e.test`;const inv=await a.call('POST','/invitations',{email,baseLevel:level});assert.equal(inv.status,201,'invite '+level+': '+JSON.stringify(inv.body));const c=new Client();const acc=await c.call('POST','/public/accept-invite',{token:new URL(inv.body.link).searchParams.get('invite')!,workspaceId:A.workspace.id,email,password:'correct-horse-battery',name:level+' Person'});assert.equal(acc.status,201,'accept '+level+': '+JSON.stringify(acc.body));c.csrf=acc.body.csrf;c.ws=A.workspace.id;return c;};
 const admin=await join('Admin'),user=await join('User');
 const boot=await a.call('GET','/bootstrap');const pipelineId=boot.body.meta.pipelineId;
 const field=await admin.call('POST','/custom-fields',{pipelineId,name:'Budget tier',type:'dropdown',options:['Low','High']});assert.equal(field.status,201,'Admin can add fields: '+JSON.stringify(field.body));
 assert.equal((await admin.call('POST','/pipelines',{name:'Renewals'})).status,201,'Admin can add pipelines');
 assert.equal((await admin.call('POST','/stages',{pipelineId,name:'Legal'})).status,201,'Admin can add stages');
 assert.equal((await admin.call('PATCH','/workspace',{name:'Hijack'})).status,403,'Admin cannot rename the workspace');
 assert.equal((await user.call('POST','/custom-fields',{pipelineId,name:'Nope',type:'text'})).status,403,'User cannot add fields');
 assert.equal((await user.call('POST','/stages',{pipelineId,name:'Nope'})).status,403,'User cannot add stages');
 // Values are validated by type and appear on the opportunity.
 const lead=await a.call('POST','/leads',{name:'Field Person',company:'Field Co',source:'Manual'});assert.equal(lead.status,201);
 const b2=await a.call('GET','/bootstrap');const contactId=b2.body.data.leads[0].contactId;
 const opp=await a.call('POST','/opportunities',{contactId,pipelineId,stageId:b2.body.meta.pipelineList.find((p:any)=>p.id===pipelineId).stages[0].id,name:'With fields',valueMinor:1000,currency:'USD',closeDate:'2026-12-01',nextStep:'Call on Monday'});assert.equal(opp.status,201,'opp: '+JSON.stringify(opp.body));
 const fieldId=field.body.id;
 assert.equal((await a.call('PUT',`/opportunities/${opp.body.id}/fields/${fieldId}`,{version:opp.body.version,value:'Medium'})).status,400,'dropdown rejects unknown options');
 const saved=await a.call('PUT',`/opportunities/${opp.body.id}/fields/${fieldId}`,{version:opp.body.version,value:'High'});assert.equal(saved.status,200);
 const deal=(await a.call('GET','/bootstrap')).body.data.deals.find((d:any)=>d.id===opp.body.id);
 assert.equal(deal.fields[fieldId],'High');assert.equal(deal.nextStep,'Call on Monday');assert.equal(deal.closeDate.slice(0,10),'2026-12-01');
});

test('acting on a lead acknowledges it; the fallback manager is configurable',async()=>{
 const a=new Client();await a.signup('Ack');
 const lead=await a.call('POST','/leads',{name:'Stage Mover',company:'Move Co',source:'Manual'});assert.equal(lead.status,201);
 const boot=await a.call('GET','/bootstrap');const pipelineId=boot.body.meta.pipelineId;const contactId=boot.body.data.leads[0].contactId;
 const stages=boot.body.meta.pipelineList.find((p:any)=>p.id===pipelineId).stages;
 const opp=await a.call('POST','/opportunities',{contactId,pipelineId,stageId:stages[0].id,name:'Acts',valueMinor:500,currency:'USD'});assert.equal(opp.status,201);
 assert.equal((await a.call('GET','/leads')).body.records[0].status,'new');
 const moved=await a.call('PATCH',`/opportunities/${opp.body.id}/stage`,{version:opp.body.version,stageId:stages[1].id});assert.equal(moved.status,200,JSON.stringify(moved.body));
 assert.equal((await a.call('GET','/leads')).body.records[0].status,'acknowledged','a stage change by the assignee acknowledges the lead');
 // Fallback manager: must be an active member of this workspace.
 const rules=boot.body.meta;const me=boot.body.meta.workspaceId&&boot.body.data.team[0].id;
 const ok=await a.call('PUT','/assignment-rules',{version:rules.rulesVersion,ackSeconds:600,idleSeconds:3600,maxEscalations:3,managerId:me});assert.equal(ok.status,200,JSON.stringify(ok.body));
 assert.equal((await a.call('GET','/bootstrap')).body.data.settings.managerId,me);
 const bad=await a.call('PUT','/assignment-rules',{version:ok.body.version,ackSeconds:600,idleSeconds:3600,maxEscalations:3,managerId:crypto.randomUUID()});assert.equal(bad.status,400);
});

test('currency is locked once money records exist; payments keep their own currency',async()=>{
 const a=new Client();await a.signup('Cur');
 assert.equal((await a.call('PATCH','/workspace',{currency:'PKR'})).status,200,'currency can change while the workspace is empty');
 await a.call('POST','/leads',{name:'Cur Person',company:'Cur Co',source:'Manual'});
 const boot=await a.call('GET','/bootstrap');const pipelineId=boot.body.meta.pipelineId;const stages=boot.body.meta.pipelineList.find((p:any)=>p.id===pipelineId).stages;
 const opp=await a.call('POST','/opportunities',{contactId:boot.body.data.leads[0].contactId,pipelineId,stageId:stages[0].id,name:'Priced',valueMinor:250000,currency:'PKR'});assert.equal(opp.status,201);
 const locked=await a.call('PATCH','/workspace',{currency:'USD'});assert.equal(locked.status,409);assert.match(locked.body.error,/cannot be changed/);
 assert.equal((await a.call('PATCH','/workspace',{name:'Renamed'})).status,200,'renaming still works');
 assert.equal((await a.call('GET','/bootstrap')).body.data.deals[0].currency,'PKR');
});
