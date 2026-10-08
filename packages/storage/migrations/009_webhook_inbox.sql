BEGIN;
CREATE TABLE IF NOT EXISTS webhook_inbox (
 tenant_id text NOT NULL,
 webhook_guid uuid NOT NULL,
 sequence_number bigint NOT NULL CHECK(sequence_number>=0),
 entity_type text NOT NULL CHECK(length(entity_type)<=80),
 entity_id bigint NOT NULL CHECK(entity_id>=0),
 action text NOT NULL CHECK(action IN ('Create','Update','Delete','Deactivated')),
 event_time timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 body_hash text NOT NULL CHECK(body_hash ~ '^[0-9a-f]{64}$'),
 PRIMARY KEY(tenant_id,webhook_guid,sequence_number)
);
INSERT INTO schema_migrations(version) VALUES('009_webhook_inbox') ON CONFLICT DO NOTHING;
COMMIT;
