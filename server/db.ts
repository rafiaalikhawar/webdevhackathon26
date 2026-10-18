import 'dotenv/config';
import pg from 'pg';
export type DB = {query:(sql:string,values?:any[])=>Promise<{rows:any[];rowCount?:number|null}>};
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,statement_timeout:10000});
export async function transaction<T>(workspaceId:string|null,fn:(db:DB)=>Promise<T>):Promise<T>{const client=await pool.connect();try{await client.query('BEGIN');if(workspaceId)await client.query("SELECT set_config('app.workspace_id',$1,true)",[workspaceId]);const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
export async function audit(db:DB,workspace:string,actor:string|null,event:string,target:string|null,before:unknown,after:unknown){await db.query('INSERT INTO audit_logs(workspace_id,actor_id,event,target_id,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6)',[workspace,actor,event,target,JSON.stringify(before),JSON.stringify(after)]);}
