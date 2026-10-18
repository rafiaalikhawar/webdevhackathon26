import 'dotenv/config';
import {pool,transaction} from './db.js';
import {processDeadlines,lockRules,routeLead} from './lead-service.js';
import {outboxTick} from './integrations/outbox.js';
let stopping=false;process.on('SIGTERM',()=>{stopping=true});process.on('SIGINT',()=>{stopping=true});
async function tick(){const workspaces=(await pool.query('SELECT id FROM workspaces')).rows;for(const workspace of workspaces){await transaction(workspace.id,async db=>{await processDeadlines(db,workspace.id);const rules=await lockRules(db,workspace.id);const waiting=(await db.query("SELECT * FROM leads WHERE workspace_id=$1 AND status='new' AND waiting_for_assignment AND escalation_step<$2 ORDER BY created_at LIMIT 10 FOR UPDATE",[workspace.id,rules.max_escalations])).rows;for(const lead of waiting){const eligible=(await db.query("SELECT m.id FROM memberships m WHERE m.workspace_id=$1 AND m.active AND m.availability='Available' AND (SELECT count(*) FROM leads l WHERE l.workspace_id=$1 AND l.current_owner_id=m.id AND l.status<>'closed')<m.capacity LIMIT 1",[workspace.id])).rows[0];if(eligible)await routeLead(db,workspace.id,lead,rules,'availability_recovery',null);}});}}
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
console.log('Relay deadline worker started. Outbox delivery (escalation alerts) is enabled.');
while(!stopping){try{await tick()}catch{console.error('Worker tick failed; records remain in PostgreSQL for retry.')}try{await outboxTick()}catch{console.error('Outbox delivery failed; events stay pending for retry.')}await new Promise(r=>setTimeout(r,1000));}await pool.end();
