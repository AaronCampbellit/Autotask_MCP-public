CREATE TABLE IF NOT EXISTS diagnostic_events (
 event_id uuid PRIMARY KEY, trace_id text NOT NULL, call_id uuid, tenant_id text, actor_id text,
 event_type text NOT NULL, occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 instance_id text NOT NULL, schema_version integer NOT NULL, details_cipher text NOT NULL
);
CREATE INDEX IF NOT EXISTS diagnostic_events_call ON diagnostic_events(tenant_id,call_id,occurred_at);
CREATE INDEX IF NOT EXISTS diagnostic_events_expiry ON diagnostic_events(expires_at);
CREATE TABLE IF NOT EXISTS diagnostic_calls (
 call_id uuid PRIMARY KEY, tenant_id text, actor_id text, trace_id text NOT NULL, parent_id uuid, instance_id text NOT NULL,
 started_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, lifecycle text NOT NULL, metadata jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS diagnostic_calls_page ON diagnostic_calls(tenant_id,started_at DESC,call_id DESC);
CREATE INDEX IF NOT EXISTS diagnostic_calls_expiry ON diagnostic_calls(expires_at);
CREATE INDEX IF NOT EXISTS diagnostic_calls_actor ON diagnostic_calls(tenant_id,actor_id,started_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_calls_tool ON diagnostic_calls(tenant_id,(metadata->>'tool'),started_at DESC);
CREATE INDEX IF NOT EXISTS diagnostic_calls_outcome ON diagnostic_calls(tenant_id,(metadata->>'outcome'),started_at DESC);
CREATE TABLE IF NOT EXISTS diagnostic_provider_attempts (
 event_id uuid PRIMARY KEY REFERENCES diagnostic_events(event_id) ON DELETE CASCADE,
 tenant_id text, call_id uuid, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS diagnostic_provider_expiry ON diagnostic_provider_attempts(expires_at);
CREATE TABLE IF NOT EXISTS diagnostic_instances(instance_id text PRIMARY KEY,heartbeat_at timestamptz NOT NULL);
DO $$ BEGIN
 IF to_regclass('control_audit') IS NOT NULL THEN
  ALTER TABLE control_audit DROP CONSTRAINT IF EXISTS control_audit_action_check;
  ALTER TABLE control_audit ADD CONSTRAINT control_audit_action_check CHECK(action IN ('member.saved','template.saved','controls.saved','job.queued','job.claimed','job.dispatched','job.finished','job.cancelled','job.cancel_requested','job.expired','job.uncertain','job.payload_purged','diagnostic.detail_viewed','diagnostic.exported'));
  ALTER TABLE control_audit DROP CONSTRAINT IF EXISTS control_audit_target_type_check;
  ALTER TABLE control_audit ADD CONSTRAINT control_audit_target_type_check CHECK(target_type IN ('member','template','controls','job','diagnostic'));
 END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES ('019_diagnostics') ON CONFLICT DO NOTHING;
