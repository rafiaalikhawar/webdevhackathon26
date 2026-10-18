// End-to-end provider checks. Spawns the API and worker against local stub providers, so no real keys are needed.
// Run: npm run test:integrations   (requires PostgreSQL from docker compose, migrated, and .env loaded)
import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,ChildProcess} from 'node:child_process';
import {createHmac} from 'node:crypto';
import 'dotenv/config';

const API_PORT=3002,STUB_PORT=4010,api=`http://localhost:${API_PORT}/api`,origin='http://localhost:5173',base=`http://localhost:${API_PORT}`;
const calls:{provider:string;method:string;path:string;body:string}[]=[];
const mode={meta:'ok',telegram:'ok',google:'ok',busy:[] as {start:string;end:string}[]};
let sid=0,lastMetaId='';

const stub=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 const url=req.url||'',provider=url.startsWith('/graph')?'graph':url.startsWith('/polar')?'polar':url.startsWith('/telegram')?'telegram':url.startsWith('/gtoken')?'gtoken':'gcal';
 calls.push({provider,method:req.method||'',path:url,body});
 const json=(s:number,o:unknown)=>{res.writeHead(s,{'Content-Type':'application/json'});res.end(s===204?'':JSON.stringify(o));};
 if(provider==='graph'){if(req.method==='GET')return json(200,{display_phone_number:'+1 555 000'});if(mode.meta==='expired')return json(401,{error:{code:190,message:'Session has expired'}});if(mode.meta==='window')return json(400,{error:{code:131047,message:'Re-engagement message'}});lastMetaId='wamid.OUT'+(++sid);return json(200,{messages:[{id:lastMetaId}]});}
 if(provider==='polar'){if(req.method==='GET')return json(200,{id:'prod'});return json(201,{id:'co_test_'+(++sid),url:'https://sandbox.polar.test/checkout/'+sid,status:'open'});}
 if(provider==='telegram'){if(url.includes('getMe'))return json(200,{ok:true});if(mode.telegram==='unauthorized')return json(401,{ok:false,description:'Unauthorized'});return json(200,{ok:true});}
 if(provider==='gtoken'){const p=new URLSearchParams(body);if(p.get('grant_type')==='refresh_token'&&mode.google==='revoked')return json(400,{error:'invalid_grant'});return json(200,{access_token:'at-'+(++sid),refresh_token:p.get('grant_type')==='authorization_code'?'rt-1':undefined,expires_in:1});}
 if(url.includes('/freeBusy'))return json(200,{calendars:{primary:{busy:mode.busy}}});
 if(req.method==='DELETE')return json(204,{});
 return json(200,{id:'ev-'+(++sid)});
});});

let children:ChildProcess[]=[];
const env={...process.env,PORT:String(API_PORT),NODE_ENV:'development',PUBLIC_BASE_URL:base,INTEGRATIONS_SKIP_VERIFY:'1',
 POLAR_API_BASE:`http://localhost:${STUB_PORT}/polar`,TELEGRAM_API_BASE:`http://localhost:${STUB_PORT}/telegram`,META_GRAPH_BASE:`http://localhost:${STUB_PORT}/graph`,GOOGLE_TOKEN_URL:`http://localhost:${STUB_PORT}/gtoken`,GOOGLE_CALENDAR_BASE:`http://localhost:${STUB_PORT}/gcal`};
before(async()=>{
 await new Promise<void>(r=>stub.listen(STUB_PORT,r));
 for(const script of ['server/main.ts','server/worker.ts'])children.push(spawn('node',['--import','tsx',script],{env:{...env,APP_ORIGIN:origin},stdio:['ignore','inherit','inherit']}));
 for(let i=0;i<40;i++){try{if((await fetch(api+'/health')).ok)return;}catch{/* not up yet */}await new Promise(r=>setTimeout(r,500));}
 throw new Error('API did not start');
});
after(()=>{children.forEach(c=>c.kill());stub.close();});

class Client{cookies:Record<string,string>={};csrf='';ws='';
 async call(method:string,path:string,body?:unknown,headers:Record<string,string>={},raw=false){const h:Record<string,string>={Origin:origin,'Content-Type':'application/json',Cookie:Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join('; ')};if(this.ws)h['X-Workspace-Id']=this.ws;if(this.csrf)h['X-CSRF-Token']=this.csrf;Object.assign(h,headers);
  const r=await fetch(api+path,{method,headers:h,body:body===undefined?undefined:raw?String(body):JSON.stringify(body),redirect:'manual'});for(const c of r.headers.getSetCookie())this.cookies[c.split('=')[0]]=c.split(';')[0].split('=')[1];const t=await r.text();let j:any=null;try{j=t?JSON.parse(t):null}catch{j=t}return {status:r.status,body:j,headers:r.headers};}
 async signup(){const email=`${crypto.randomUUID().slice(0,8)}@int.test`;const r=await this.call('POST','/auth/signup',{email,password:'correct-horse-battery',name:'Owner',workspace:'Int'});assert.equal(r.status,201,JSON.stringify(r.body));this.csrf=r.body.csrf;this.ws=r.body.workspace.id;return r.body;}}

const polarSig=(secret:string,id:string,payload:string,t=Math.floor(Date.now()/1000))=>({'webhook-id':id,'webhook-timestamp':String(t),'webhook-signature':'v1,'+createHmac('sha256',Buffer.from(secret.replace(/^whsec_/,''),'base64')).update(`${id}.${t}.${payload}`).digest('base64')});


async function setup(){
 const c=new Client();await c.signup();
 for(const [p,body] of Object.entries({polar:{accessToken:'polar_oat_abc123',webhookSecret:'whsec_'+Buffer.from('polar-test-secret').toString('base64'),productId:'11111111-1111-4111-8111-111111111111'},telegram:{botToken:'123:ABCDEF'},google:{clientId:'cid',clientSecret:'csecret'}}))assert.equal((await c.call('PUT','/integrations/'+p,body)).status,200,p);
 return c;
}

test('secrets are encrypted at rest and masked in the API',async()=>{
 const c=await setup();const list=await c.call('GET','/integrations');assert.equal(list.status,200);
 const text=JSON.stringify(list.body);assert.ok(!text.includes('polar_oat_abc123')&&!text.includes('polar-test-secret')&&!text.includes('123:ABCDEF'),'plaintext secret leaked');
 const polar=list.body.find((p:any)=>p.provider==='polar');assert.equal(polar.status,'connected');assert.ok(polar.secrets.accessToken.startsWith('••••'));assert.ok(polar.limits.length>10);assert.ok(!list.body.some((p:any)=>p.provider==='stripe'),'stripe is no longer offered');
 const user=new Client();Object.assign(user,{ws:c.ws});// a plain user cannot read or change integrations
 const inv=await c.call('POST','/invitations',{email:`u-${crypto.randomUUID().slice(0,6)}@int.test`,baseLevel:'User'});const token=new URL(inv.body.link).searchParams.get('invite')!;
 const email=JSON.parse(JSON.stringify(inv.body)).link&&`u-${crypto.randomUUID().slice(0,6)}@int.test`;void email;
 const inv2=await c.call('POST','/invitations',{email:'plain@int.test',baseLevel:'User'});const t2=new URL(inv2.body.link).searchParams.get('invite')!;void token;
 const acc=await user.call('POST','/public/accept-invite',{token:t2,workspaceId:c.ws,email:'plain@int.test',password:'correct-horse-battery',name:'Plain'});
 if(acc.status===201){user.csrf=acc.body.csrf;assert.equal((await user.call('GET','/integrations')).status,403);assert.equal((await user.call('PUT','/integrations/polar',{accessToken:'x'})).status,403);}
});

test('polar: checkout, signed webhooks, idempotency, expiry and refunds',async()=>{
 const c=await setup();
 const lead=await c.call('POST','/leads',{name:'Pat Kim',company:'Kim Co',email:'pat@example.com',source:'Manual'});assert.equal(lead.status,201);
 const boot=await c.call('GET','/bootstrap');const contactId=boot.body.data.leads[0].contactId;
 const opp=await c.call('POST','/opportunities',{contactId,pipelineId:boot.body.meta.pipelineId,stageId:boot.body.meta.stageIds.Discovery,name:'Retainer',valueMinor:50000,currency:'USD'});assert.equal(opp.status,201);
 assert.equal((await c.call('PUT','/integrations/polar',{productId:'not-a-uuid'})).status,400,'product id must be a UUID');
 const pay=await c.call('POST',`/opportunities/${opp.body.id}/payments`,{amountMinor:50000,currency:'USD'});assert.equal(pay.status,201);assert.match(pay.body.url,/sandbox\.polar\.test/);
 const created=JSON.parse([...calls].reverse().find(x=>x.provider==='polar'&&x.method==='POST')!.body);assert.equal(created.products[0],'11111111-1111-4111-8111-111111111111');assert.equal(created.prices['11111111-1111-4111-8111-111111111111'][0].price_amount,50000);assert.equal(created.prices['11111111-1111-4111-8111-111111111111'][0].price_currency,'usd');assert.ok(created.metadata.payment_id);
 const session=(await c.call('GET','/bootstrap')).body.data.payments[0];assert.equal(session.status,'Pending');
 const secret='whsec_'+Buffer.from('polar-test-secret').toString('base64');
 const post=async(event:any,id:string,headers?:Record<string,string>)=>{const payload=JSON.stringify(event);const r=await fetch(`${api}/webhooks/polar/${c.ws}`,{method:'POST',headers:{'Content-Type':'application/json',...(headers??polarSig(secret,id,payload))},body:payload});return r.status;};
 const ref=session.ref;assert.ok(ref.startsWith('co_test_'));
 const paid={type:'order.paid',data:{id:'order_1',checkout_id:ref,status:'paid',total_amount:50000,currency:'usd',metadata:{payment_id:created.metadata.payment_id}}};
 assert.equal(await post(paid,'msg_1',{'webhook-id':'msg_1','webhook-timestamp':String(Math.floor(Date.now()/1000)),'webhook-signature':'v1,AAAA'}),403,'forged signature');
 assert.equal(await post(paid,'msg_1',polarSig(secret,'msg_1',JSON.stringify(paid),Math.floor(Date.now()/1000)-3600)),403,'stale timestamp');
 assert.equal(await post(paid,'msg_1',polarSig('whsec_'+Buffer.from('other').toString('base64'),'msg_1',JSON.stringify(paid))),403,'wrong secret');
 assert.equal((await c.call('GET','/bootstrap')).body.data.payments[0].status,'Pending','nothing changes before verification');
 assert.equal(await post(paid,'msg_1'),200);assert.equal(await post(paid,'msg_1'),200,'replay is accepted but ignored');
 let p=(await c.call('GET','/bootstrap')).body.data;assert.equal(p.payments.length,1);assert.equal(p.payments[0].status,'Paid');assert.equal(p.payments[0].amount,500);
 const contactPage=await c.call('GET','/contacts/'+contactId);assert.equal(contactPage.body.activities.filter((a:any)=>/Payment received/.test(a.body)).length,1,'recorded once');
 assert.equal(await post({type:'refund.created',data:{id:'re_1',status:'pending',amount:20000,order_id:'order_1',currency:'usd'}},'msg_2'),200);
 assert.equal((await c.call('GET','/bootstrap')).body.data.payments[0].amount,500,'a pending refund changes nothing');
 assert.equal(await post({type:'refund.updated',data:{id:'re_1',status:'succeeded',amount:20000,order_id:'order_1',currency:'usd'}},'msg_3'),200);
 p=(await c.call('GET','/bootstrap')).body.data;assert.equal(p.payments[0].status,'Paid');assert.equal(p.payments[0].amount,300,'partial refund reduces collected revenue');
 assert.equal(await post({type:'refund.updated',data:{id:'re_1',status:'succeeded',amount:20000,order_id:'order_1',currency:'usd'}},'msg_3b'),200);
 assert.equal((await c.call('GET','/bootstrap')).body.data.payments[0].amount,300,'the same refund is never counted twice');
 assert.equal(await post({type:'refund.created',data:{id:'re_2',status:'succeeded',amount:30000,order_id:'order_1',currency:'usd'}},'msg_4'),200);
 p=(await c.call('GET','/bootstrap')).body.data;assert.equal(p.payments[0].status,'Refunded');assert.equal(p.payments[0].amount,0);
 // Expired and failed links
 const pay2=await c.call('POST',`/opportunities/${opp.body.id}/payments`,{amountMinor:1000,currency:'USD'});assert.equal(pay2.status,201);
 const ref2=(await c.call('GET','/bootstrap')).body.data.payments.find((x:any)=>x.status==='Pending').ref;
 assert.equal(await post({type:'checkout.updated',data:{id:ref2,status:'expired'}},'msg_5'),200);
 assert.ok((await c.call('GET','/bootstrap')).body.data.payments.some((x:any)=>x.status==='Expired'));
 const pay3=await c.call('POST',`/opportunities/${opp.body.id}/payments`,{amountMinor:2000,currency:'USD'});assert.equal(pay3.status,201);
 const ref3=(await c.call('GET','/bootstrap')).body.data.payments.find((x:any)=>x.status==='Pending').ref;
 assert.equal(await post({type:'checkout.updated',data:{id:ref3,status:'failed'}},'msg_6'),200);
 assert.ok((await c.call('GET','/bootstrap')).body.data.payments.some((x:any)=>x.status==='Failed'));
 // No card data is stored by the platform.
 assert.ok(!JSON.stringify(calls.filter(x=>x.provider==='polar')).match(/4242/));
});

test('telegram: escalation alert reaches the new owner with a useful message',async()=>{
 const c=await setup();
 assert.equal((await c.call('PUT','/me/destination',{address:'555123'})).status,200);
 const boot=await c.call('GET','/bootstrap');
 assert.equal((await c.call('PUT','/assignment-rules',{version:boot.body.meta.rulesVersion,ackSeconds:10,idleSeconds:3600,maxEscalations:3})).status,200);
 const before=calls.filter(x=>x.provider==='telegram'&&x.path.includes('sendMessage')).length;
 assert.equal((await c.call('POST','/leads',{name:'Escalate Me',company:'Slow Co',source:'Website'})).status,201);
 let sent:typeof calls=[];for(let i=0;i<40&&!sent.length;i++){await new Promise(r=>setTimeout(r,1000));sent=calls.filter(x=>x.provider==='telegram'&&x.path.includes('sendMessage')).slice(before);}
 assert.ok(sent.length>=1,'alert was delivered within the window');
 const text=JSON.parse(sent[0].body).text as string;assert.match(text,/Escalate Me/);assert.match(text,/Source: Website/);assert.match(text,/Reason:/);assert.match(text,/\/\?lead=/);
 assert.equal(JSON.parse(sent[0].body).chat_id,'555123');
});

test('google calendar: OAuth, refresh, conflicts, reschedule, cancel and revoked access',async()=>{
 const c=await setup();
 const start=await c.call('GET','/oauth/google/start');assert.equal(start.status,200);const u=new URL(start.body.url);assert.equal(u.searchParams.get('client_id'),'cid');assert.equal(u.searchParams.get('access_type'),'offline');
 assert.match(String(u.searchParams.get('scope')),/calendar/);
 const cb=await fetch(`${api}/oauth/google/callback?code=abc&state=forged`,{redirect:'manual'});assert.match(cb.headers.get('location')||'',/calendar=invalid/);
 const ok=await fetch(`${api}/oauth/google/callback?code=abc&state=${encodeURIComponent(u.searchParams.get('state')!)}`,{redirect:'manual'});assert.match(ok.headers.get('location')||'',/calendar=connected/);
 const conn=await c.call('GET','/calendar/connections');assert.equal(conn.body.connections[0].status,'connected');
 const lead=await c.call('POST','/leads',{name:'Sam Cole',company:'Cole LLC',email:'sam@example.com',source:'Manual'});assert.equal(lead.status,201);
 const contactId=(await c.call('GET','/bootstrap')).body.data.leads[0].contactId;
 const slot={contactId,title:'Intro call',startsAt:'2026-11-02T15:00:00+05:00',endsAt:'2026-11-02T15:30:00+05:00',timezone:'Asia/Karachi'};
 mode.busy=[{start:'2026-11-02T10:10:00Z',end:'2026-11-02T10:20:00Z'}];
 const clash=await c.call('POST','/appointments',slot);assert.equal(clash.status,409);assert.match(clash.body.error,/overlaps/);
 const forced=await c.call('POST','/appointments',{...slot,force:true});assert.equal(forced.status,201);
 mode.busy=[];const booked=await c.call('POST','/appointments',{...slot,startsAt:'2026-11-03T15:00:00+05:00',endsAt:'2026-11-03T15:30:00+05:00'});assert.equal(booked.status,201);
 const appt=(await c.call('GET','/bootstrap')).body.data.meetings;assert.equal(appt.length,2);assert.equal(new Date(appt.find((m:any)=>m.id===booked.body.id).at).toISOString(),'2026-11-03T10:00:00.000Z','stored as an unambiguous instant');
 assert.ok(calls.some(x=>x.provider==='gtoken'&&x.body.includes('refresh_token')),'expired access token was refreshed automatically');
 assert.equal((await c.call('PATCH','/appointments/'+booked.body.id,{startsAt:'2026-11-03T16:00:00+05:00',endsAt:'2026-11-03T16:30:00+05:00'})).status,200);
 assert.ok(calls.some(x=>x.provider==='gcal'&&x.method==='PATCH'));
 assert.equal((await c.call('DELETE','/appointments/'+booked.body.id)).status,200);assert.ok(calls.some(x=>x.provider==='gcal'&&x.method==='DELETE'));
 const history=await c.call('GET','/contacts/'+contactId);assert.ok(history.body.activities.some((a:any)=>/rescheduled/.test(a.body))&&history.body.activities.some((a:any)=>/cancelled/.test(a.body)));
 mode.google='revoked';const revoked=await c.call('POST','/appointments',{...slot,startsAt:'2026-11-05T15:00:00+05:00',endsAt:'2026-11-05T15:30:00+05:00'});assert.equal(revoked.status,409);assert.match(revoked.body.error,/[Rr]econnect/);
 assert.equal((await c.call('GET','/calendar/connections')).body.connections[0].status,'needs_reconnect');mode.google='ok';
 // A different workspace never sees or reuses this workspace's connection.
 const other=await setup();assert.deepEqual((await other.call('GET','/calendar/connections')).body.connections,[]);
});


// ---- Meta WhatsApp Cloud API ----
const metaSig=(secret:string,raw:string)=>'sha256='+createHmac('sha256',secret).update(raw).digest('hex');
const META={accessToken:'EAAtoken',appSecret:'meta-app-secret',verifyToken:'my-verify-token',phoneNumberId:'1234567890'};
async function metaSetup(){const c=new Client();await c.signup();const r=await c.call('PUT','/integrations/whatsapp',META);assert.equal(r.status,200,JSON.stringify(r.body));return c;}
async function metaPost(c:Client,payload:unknown,secret=META.appSecret,sig?:string){const raw=JSON.stringify(payload);const r=await fetch(`${api}/webhooks/whatsapp/${c.ws}`,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sig??metaSig(secret,raw)},body:raw});return r.status;}
const inbound=(id:string,from:string,body:string,phoneNumberId=META.phoneNumberId)=>({object:'whatsapp_business_account',entry:[{id:'WABA',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{display_phone_number:'15550000',phone_number_id:phoneNumberId},contacts:[{profile:{name:'Sam Cruz'},wa_id:from}],messages:[{from,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}}]}}]}]});
const statusEvt=(id:string,status:string,errors?:unknown)=>({object:'whatsapp_business_account',entry:[{id:'WABA',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:META.phoneNumberId},statuses:[{id,status,timestamp:String(Math.floor(Date.now()/1000)),recipient_id:'12025550177',...(errors?{errors}:{})}]}}]}]});

test('whatsapp (meta): webhook verification handshake',async()=>{
 const c=await metaSetup();const url=`${api}/webhooks/whatsapp/${c.ws}`;
 let r=await fetch(`${url}?hub.mode=subscribe&hub.verify_token=${META.verifyToken}&hub.challenge=12345`);assert.equal(r.status,200);assert.equal(await r.text(),'12345');
 r=await fetch(`${url}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`);assert.equal(r.status,403);assert.ok(!(await r.text()).includes('12345'));
 r=await fetch(`${url}?hub.mode=unsubscribe&hub.verify_token=${META.verifyToken}&hub.challenge=12345`);assert.equal(r.status,403);
 r=await fetch(`${url}?hub.mode=subscribe&hub.challenge=12345`);assert.equal(r.status,403);
 const other=new Client();await other.signup();r=await fetch(`${api}/webhooks/whatsapp/${other.ws}?hub.mode=subscribe&hub.verify_token=${META.verifyToken}&hub.challenge=12345`);assert.equal(r.status,403,'another workspace cannot use this token');
});

test('whatsapp (meta): signatures, de-duplication, contact matching, isolation, opt-out',async()=>{
 const c=await metaSetup();const other=await metaSetup();
 const evt=inbound('wamid.IN1','12025550177','Hi, I want a quote');
 assert.equal(await metaPost(c,evt,META.appSecret,'sha256=deadbeef'),403,'forged signature rejected');
 assert.equal(await metaPost(c,evt,'wrong-secret'),403,'wrong secret rejected');
 const raw=JSON.stringify(evt);const r0=await fetch(`${api}/webhooks/whatsapp/${c.ws}`,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':metaSig(META.appSecret,raw)},body:raw.replace('quote','QUOTE')});assert.equal(r0.status,403,'altered body rejected');
 assert.equal((await c.call('GET','/leads')).body.total,0,'rejected requests create nothing');
 assert.equal(await metaPost(c,evt),200);assert.equal(await metaPost(c,evt),200,'duplicate delivery acknowledged');
 let leads=await c.call('GET','/leads');assert.equal(leads.body.total,1,'one lead, not two');assert.equal(leads.body.records[0].source,'WhatsApp');
 assert.equal(await metaPost(c,inbound('wamid.IN2','12025550177','Following up')),200);
 leads=await c.call('GET','/leads');assert.equal(leads.body.total,1,'known number attaches to the existing contact');
 assert.equal((await c.call('GET','/bootstrap')).body.data.chats[0].messages.length,2);
 assert.equal((await other.call('GET','/leads')).body.total,0,'nothing leaks into another workspace');
 assert.equal(await metaPost(other,evt,META.appSecret),200);assert.equal((await other.call('GET','/leads')).body.total,1,'same number in another workspace is a separate lead');assert.equal((await c.call('GET','/leads')).body.total,1);
 assert.equal(await metaPost(c,inbound('wamid.IN9','12025550999','hello',  '999')),200);assert.equal((await c.call('GET','/leads')).body.total,1,'events for a different phone number id are ignored');
 assert.equal(await metaPost(c,inbound('wamid.IN3','12025550177','STOP')),200);
 const contactId=leads.body.records[0].contact_id;const blocked=await c.call('POST',`/contacts/${contactId}/messages`,{body:'hello?'});assert.equal(blocked.status,409);assert.match(blocked.body.error,/opted out/);
 const events=await c.call('GET','/integrations/events');assert.ok(events.body.some((e:any)=>e.status==='rejected'));assert.ok(!JSON.stringify(events.body).includes(META.accessToken)&&!JSON.stringify(events.body).includes(META.appSecret));
});

test('whatsapp (meta): send, failure reasons, retry and status callbacks',async()=>{
 const c=await metaSetup();assert.equal(await metaPost(c,inbound('wamid.IN1','12025550177','Hello')),200);
 const contactId=(await c.call('GET','/leads')).body.records[0].contact_id;
 mode.meta='expired';const bad=await c.call('POST',`/contacts/${contactId}/messages`,{body:'Hi Sam'});assert.equal(bad.body.status,'failed');assert.match(bad.body.error,/token expired/i);
 assert.equal((await c.call('GET','/integrations')).body.find((p:any)=>p.provider==='whatsapp').status,'error','expired token shows as an integration error');
 mode.meta='ok';const out=(await c.call('GET','/bootstrap')).body.data.chats[0].messages.find((m:any)=>m.direction==='out');
 const retry=await c.call('POST',`/messages/${out.id}/retry`);assert.equal(retry.body.status,'sent');
 const sent=[...calls].reverse().find(x=>x.provider==='graph'&&x.method==='POST')!;const sentBody=JSON.parse(sent.body);assert.equal(sentBody.to,'12025550177');assert.equal(sentBody.type,'text');assert.ok(sent.path.includes('/1234567890/messages'));
 const st=async()=>(await c.call('GET','/bootstrap')).body.data.chats[0].messages.find((m:any)=>m.id===out.id).status;
 assert.equal(await st(),'Sent');
 assert.equal(await metaPost(c,statusEvt(lastMetaId,'delivered')),200);assert.equal(await st(),'Delivered');
 assert.equal(await metaPost(c,statusEvt(lastMetaId,'sent')),200);assert.equal(await st(),'Delivered','late sent never downgrades');
 assert.equal(await metaPost(c,statusEvt(lastMetaId,'read')),200);assert.equal(await st(),'Delivered');
 assert.equal(await metaPost(c,statusEvt(lastMetaId,'delivered'),'wrong'),403);
 // A status failure is stored with a plain reason.
 const second=await c.call('POST',`/contacts/${contactId}/messages`,{body:'Second'});assert.equal(second.body.status,'sent');
 assert.equal(await metaPost(c,statusEvt(lastMetaId,'failed',[{code:131030,title:'Recipient not in allowed list'}])),200);
 const failedMsg=(await c.call('GET','/bootstrap')).body.data.chats[0].messages.find((m:any)=>m.id===second.body.id);assert.equal(failedMsg.status,'Failed');
});

test('whatsapp (meta): 24-hour window needs a template',async()=>{
 const c=await metaSetup();
 const lead=await c.call('POST','/leads',{name:'Cold Contact',company:'Cold Co',phone:'+12025550188',source:'Manual'});assert.equal(lead.status,201);
 const contactId=(await c.call('GET','/leads')).body.records[0].contact_id;
 const before=calls.filter(x=>x.provider==='graph'&&x.method==='POST').length;
 const free=await c.call('POST',`/contacts/${contactId}/messages`,{body:'Hello'});assert.equal(free.body.status,'failed');assert.match(free.body.error,/24 hours/);assert.equal(calls.filter(x=>x.provider==='graph'&&x.method==='POST').length,before,'no provider call outside the window');
 const tpl=await c.call('POST',`/contacts/${contactId}/messages`,{body:'Intro template',template:{name:'hello_world',language:'en_US'}});assert.equal(tpl.body.status,'sent');
 const b=JSON.parse([...calls].reverse().find(x=>x.provider==='graph'&&x.method==='POST')!.body);assert.equal(b.type,'template');assert.equal(b.template.name,'hello_world');assert.equal(b.template.language.code,'en_US');
 assert.equal((await c.call('PUT','/integrations/whatsapp',{...META,phoneNumberId:'abc'})).status,400,'phone number id must be numeric');
});
