-- Polar replaces Stripe as the payments provider. 'stripe' stays allowed so existing rows remain valid.
ALTER TABLE integrations DROP CONSTRAINT integrations_provider_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check CHECK(provider IN ('twilio','stripe','google','telegram','whatsapp','polar'));
INSERT INTO schema_migrations(version) VALUES('004_polar');
