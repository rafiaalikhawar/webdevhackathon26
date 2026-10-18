// Manual crash/restart check for escalation timers (requirement Q5). Needs the local API on :3001 and the owner DB URL in .env.
// Run: node --import tsx tests/restart.e2e.ts   (pause any other worker on the same database first)
import 'dotenv/config';
import pg from 'pg';
import {spawn,type ChildProcess} from 'node:child_process';
import assert from 'node:assert/strict';
const api='http://localhost:3001/api',origin=process.env.APP_ORIGIN||'http://localhost:5173';
const owner=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const workers:ChildProcess[]=[];
const startWorker=()=>{const w=spawn('node',['--import','tsx','server/worker.ts'],{stdio:'ignore',env:{...process.env,NODE_ENV:'development'}});workers.push(w);return w;};
const killAll=async()=>{for(const w of workers.splice(0))w.kill('SIGKILL');await sleep(300);};
const rnd=Math.random().toString(36).slice(2,8);
let cookie='',csrf='',ws='';
async function call(method:string,path:string,body?:unknown){const r=await fetch(api+path,{method,headers:{'content-type':'application/json',origin,cookie,'x-csrf-token':csrf,'x-workspace-id':ws},body:body?JSON.stringify(body):undefined});const sc=r.headers.getSetCookie?.().map(c=>c.split(';')[0]).join('; ');if(sc)cookie=sc;return r.json();}
async function state(leadId:string){const lead=(await owner.query('SELECT status,current_owner_id,escalation_count,escalation_step,acknowledgment_deadline FROM leads WHERE id=$1',[leadId])).rows[0];const esc=(await owner.query("SELECT count(*)::int AS n FROM lead_assignments WHERE lead_id=$1 AND reason='escalation'",[leadId])).rows[0].n;return {...lead,escalations:esc};}
try{
 const s=await call('POST','/auth/signup',{name:'Restart Test',workspace:'restart-'+rnd,email:`restart-${rnd}@example.com`,password:'correct-horse-battery'});csrf=s.csrf;ws=s.workspace.id;
 for(const n of ['a','b']){const u=(await owner.query("INSERT INTO users(email,password_hash,name) VALUES($1,'x',$2) RETURNING id",[`${n}-${rnd}@example.com`,'Member '+n])).rows[0].id;await owner.query("INSERT INTO memberships(workspace_id,user_id,base_level) VALUES($1,$2,'User')",[ws,u]);}
 await owner.query('UPDATE assignment_rules SET ack_seconds=10,max_escalations=5 WHERE workspace_id=$1',[ws]);
 const lead=await call('POST','/leads',{name:'Restart Lead',company:'Timer Co',phone:'+1555'+String(Math.floor(1e6+Math.random()*9e6))});assert.ok(lead.id,'lead created: '+JSON.stringify(lead));
 console.log('lead created, 10s window, no worker running (simulated downtime)');
 await sleep(12000);
 let st=await state(lead.id);assert.equal(st.escalations,0);assert.equal(st.status,'new');console.log('downtime: deadline passed, nothing escalated yet');
 console.log('phase A: two workers start together after downtime');startWorker();startWorker();await sleep(5000);
 st=await state(lead.id);assert.equal(st.escalations,1,'exactly one escalation after catch-up with two workers');console.log('ok: escalations =',st.escalations);
 console.log('phase B: workers killed hard (SIGKILL) while the new 10s timer runs');await killAll();await sleep(11000);
 startWorker();startWorker();await sleep(5000);
 st=await state(lead.id);assert.equal(st.escalations,2,'exactly one more escalation after crash and restart');console.log('ok: escalations =',st.escalations);
 const dup=(await owner.query("SELECT count(*)::int AS n FROM (SELECT lead_version FROM lead_assignments WHERE lead_id=$1 GROUP BY lead_version HAVING count(*)>1) d",[lead.id])).rows[0].n;assert.equal(dup,0,'no assignment version recorded twice');
 console.log('PASS: timers survive downtime, crash and concurrent workers without double escalation');
}finally{await killAll();await owner.end();}
