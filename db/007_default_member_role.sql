-- Invited Users had no permissions at all and could not even open the app. Give every workspace a "Member" role
-- (view, create and edit own records) and assign it to existing Users who have no role yet.
INSERT INTO roles(workspace_id,name) SELECT id,'Member' FROM workspaces ON CONFLICT(workspace_id,name) DO NOTHING;
INSERT INTO role_permissions(workspace_id,role_id,permission_code)
 SELECT r.workspace_id,r.id,p.code FROM roles r CROSS JOIN (VALUES ('crm.view'),('crm.create'),('crm.edit')) AS p(code)
 WHERE r.name='Member' AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id=r.id)
 ON CONFLICT DO NOTHING;
INSERT INTO membership_roles(workspace_id,membership_id,role_id)
 SELECT m.workspace_id,m.id,r.id FROM memberships m JOIN roles r ON r.workspace_id=m.workspace_id AND r.name='Member'
 WHERE m.base_level='User' AND m.active AND NOT EXISTS (SELECT 1 FROM membership_roles x WHERE x.membership_id=m.id)
 ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('007_default_member_role');
