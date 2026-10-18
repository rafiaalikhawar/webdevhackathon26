-- Pipelines, stages and custom fields get their own permission so Admins can configure the CRM without owning the workspace.
INSERT INTO permissions(code,description) VALUES ('config.manage','Manage pipelines, stages and custom fields') ON CONFLICT DO NOTHING;
ALTER TABLE opportunities ADD COLUMN next_step text;
ALTER TABLE assignment_rules ADD COLUMN manager_member_id uuid, ADD CONSTRAINT assignment_rules_manager_fk FOREIGN KEY(manager_member_id,workspace_id) REFERENCES memberships(id,workspace_id);
INSERT INTO schema_migrations(version) VALUES('006_config_permission');
