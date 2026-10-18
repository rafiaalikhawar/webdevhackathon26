import 'dotenv/config';
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL});
const db=await pool.connect();
try{
 await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(74461001)");
 const dir=new URL('../db/',import.meta.url);
 const files=(await readdir(dir)).filter(f=>/^\d{3}_.*\.sql$/.test(f)).sort();
 const hasTable=(await db.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0].t;
 const applied=new Set(hasTable?(await db.query('SELECT version FROM schema_migrations')).rows.map(r=>r.version):[]);
 let count=0;
 for(const file of files){const version=file.replace('.sql','');if(applied.has(version))continue;await db.query(await readFile(new URL(file,dir),'utf8'));console.log('Applied '+version+'.');count++;}
 if(!count)console.log('Schema already up to date.');
 await db.query('COMMIT');
}catch(e){await db.query('ROLLBACK');console.error('Migration failed. No partial schema was committed.',e instanceof Error?e.message:'');process.exitCode=1;}finally{db.release();await pool.end();}
