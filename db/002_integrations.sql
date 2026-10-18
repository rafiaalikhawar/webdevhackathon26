-- Integration status, error tracking and payment checkout details.
ALTER TABLE integrations ADD COLUMN last_error text, ADD COLUMN last_error_at timestamptz, ADD COLUMN config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE integration_events ADD COLUMN error text, ADD COLUMN next_attempt_at timestamptz, ADD COLUMN event_type text;
ALTER TABLE payments ADD COLUMN checkout_url text, ADD COLUMN payment_intent_id text, ADD COLUMN charge_id text;
CREATE INDEX payments_intent ON payments(workspace_id,payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX integration_events_recent ON integration_events(workspace_id,created_at DESC);
ALTER TABLE outbox_events ADD COLUMN last_error text;
INSERT INTO schema_migrations(version) VALUES('002_integrations');
