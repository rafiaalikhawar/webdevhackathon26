-- Meta WhatsApp Cloud API: new provider value and optional template sends.
ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK(provider IN ('twilio','stripe','google','telegram','whatsapp'));
ALTER TABLE messages ADD COLUMN template jsonb;
INSERT INTO schema_migrations(version) VALUES('003_whatsapp');
