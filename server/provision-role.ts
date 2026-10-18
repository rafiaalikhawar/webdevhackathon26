import 'dotenv/config';
import pg from 'pg';
// Idempotent: creates/updates the restricted runtime role (no superuser, no BYPASSRLS, not an owner) and its grants.
// Works on any hosted PostgreSQL (database name is read from the connection). Run after `npm run db:migrate`.
const url=process.env.MIGRATION_DATABASE_URL,password=process.env.RUNTIME_DB_PASSWORD;
if(!url||!password){console.error('MIGRATION_DATABASE_URL and RUNTIME_DB_PASSWORD are required.');process.exit(1);}
const pool=new pg.Pool({connectionString:url,max:1});
try{
 const q=(sql:string,p?:any[])=>pool.query(sql,p);
 await q("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='relay_app') THEN CREATE ROLE relay_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$");
 const pw=(await q("SELECT format('ALTER ROLE relay_app PASSWORD %L',$1::text) AS s",[password])).rows[0].s;await q(pw);
 const db=(await q('SELECT current_database() AS d')).rows[0].d as string;
 await q(`GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(db)} TO relay_app`);
 for(const s of ['GRANT USAGE ON SCHEMA public TO relay_app','GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO relay_app','GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO relay_app','ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO relay_app','REVOKE ALL ON schema_migrations FROM relay_app','REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs FROM relay_app','REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON permissions FROM relay_app'])await q(s);
 const r=(await q("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='relay_app'")).rows[0];
 console.log(`Runtime role ready on database ${db} (superuser=${r.rolsuper}, bypassrls=${r.rolbypassrls}).`);
}catch(e){console.error('Role provisioning failed:',e instanceof Error?e.message:e);process.exitCode=1;}finally{await pool.end();}
