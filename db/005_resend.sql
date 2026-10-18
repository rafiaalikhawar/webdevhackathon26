-- Email alerts through Resend replace Telegram. Older provider values stay allowed so existing rows remain valid.
ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK(provider IN ('twilio','stripe','google','telegram','whatsapp','polar','resend'));
INSERT INTO schema_migrations(version) VALUES('005_resend');
