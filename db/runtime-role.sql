-- Execute after migrations as the database owner. Set the password using psql \password relay_app.
-- Do not insert production passwords in this tracked file.
CREATE ROLE relay_app LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE relay TO relay_app;
GRANT USAGE ON SCHEMA public TO relay_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO relay_app;
REVOKE ALL ON schema_migrations FROM relay_app;
REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs FROM relay_app;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON permissions FROM relay_app;
