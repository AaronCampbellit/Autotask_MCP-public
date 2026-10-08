BEGIN;

-- Fail rather than silently choose an employee if a preexisting tenant has duplicate resource mappings.
CREATE UNIQUE INDEX IF NOT EXISTS identity_mappings_tenant_resource_idx ON identity_mappings (tenant_id, resource_id);

CREATE TABLE IF NOT EXISTS control_permission_templates (
  tenant_id text NOT NULL, template_key text NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  version integer NOT NULL CHECK (version > 0), policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  PRIMARY KEY (tenant_id, template_key)
);
CREATE TABLE IF NOT EXISTS control_dispatch_controls (
  tenant_id text PRIMARY KEY, version integer NOT NULL CHECK (version > 0),
  write_paused boolean NOT NULL, tools jsonb NOT NULL CHECK (jsonb_typeof(tools) = 'object')
);
CREATE TABLE IF NOT EXISTS control_audit (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, actor_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('member.saved','template.saved','controls.saved','job.queued','job.claimed','job.dispatched','job.finished','job.cancelled','job.cancel_requested','job.expired','job.uncertain','job.payload_purged')),
  target_type text NOT NULL CHECK (target_type IN ('member','template','controls','job')),
  target_id text NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256), at timestamptz NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object' AND details - ARRAY['version','state','fence']::text[] = '{}'::jsonb)
);
CREATE INDEX IF NOT EXISTS control_audit_tenant_at_idx ON control_audit (tenant_id, at DESC, id DESC);
CREATE OR REPLACE FUNCTION control_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Control audit is append only' USING ERRCODE = '23514'; END; $$;
DROP TRIGGER IF EXISTS control_audit_immutable ON control_audit;
CREATE TRIGGER control_audit_immutable BEFORE UPDATE OR DELETE ON control_audit FOR EACH ROW EXECUTE FUNCTION control_audit_append_only();
DROP TRIGGER IF EXISTS control_audit_no_truncate ON control_audit;
CREATE TRIGGER control_audit_no_truncate BEFORE TRUNCATE ON control_audit FOR EACH STATEMENT EXECUTE FUNCTION control_audit_append_only();

CREATE TABLE IF NOT EXISTS control_jobs (
  id uuid PRIMARY KEY, tenant_id text NOT NULL, actor_key text NOT NULL,
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128), payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  resource_id bigint NOT NULL CHECK (resource_id > 0 AND resource_id <= 9007199254740991),
  mapping_version integer NOT NULL CHECK (mapping_version > 0), policy_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled','expired','uncertain')),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, run_after timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  encrypted_payload text CHECK (encrypted_payload IS NULL OR (length(encrypted_payload) <= 174806 AND encrypted_payload ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$')),
  payload_purged_at timestamptz,
  fence integer NOT NULL DEFAULT 0 CHECK (fence BETWEEN 0 AND 10), lease_token uuid, lease_owner text, lease_expires_at timestamptz,
  dispatched boolean NOT NULL DEFAULT false, cancel_requested boolean NOT NULL DEFAULT false, operation_id uuid REFERENCES operation_journal(id),
  UNIQUE (actor_key, request_key),
  CHECK (actor_key LIKE tenant_id || ':%'),
  CHECK (isfinite(created_at) AND isfinite(expires_at) AND expires_at > created_at AND expires_at > run_after),
  CHECK ((encrypted_payload IS NOT NULL AND payload_purged_at IS NULL) OR (encrypted_payload IS NULL AND payload_purged_at IS NOT NULL AND state NOT IN ('queued','running'))),
  CHECK (state <> 'running' OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND fence > 0))
);
CREATE INDEX IF NOT EXISTS control_jobs_owner_at_idx ON control_jobs (actor_key, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS control_jobs_ready_idx ON control_jobs (run_after, id) WHERE state IN ('queued','running');
CREATE OR REPLACE FUNCTION control_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.tenant_id,NEW.actor_key,NEW.request_key,NEW.payload_hash,NEW.operation,NEW.resource_id,NEW.mapping_version,NEW.policy_version,NEW.created_at,NEW.run_after,NEW.expires_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.actor_key,OLD.request_key,OLD.payload_hash,OLD.operation,OLD.resource_id,OLD.mapping_version,OLD.policy_version,OLD.created_at,OLD.run_after,OLD.expires_at)
     OR (OLD.dispatched AND NOT NEW.dispatched) OR (OLD.cancel_requested AND NOT NEW.cancel_requested) THEN
    RAISE EXCEPTION 'Job identity and intent are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.encrypted_payload IS DISTINCT FROM OLD.encrypted_payload OR NEW.payload_purged_at IS DISTINCT FROM OLD.payload_purged_at THEN
    IF NOT (OLD.state NOT IN ('queued','running') AND OLD.encrypted_payload IS NOT NULL AND NEW.encrypted_payload IS NULL AND NEW.payload_purged_at IS NOT NULL
      AND (to_jsonb(NEW) - ARRAY['encrypted_payload','payload_purged_at']::text[]) = (to_jsonb(OLD) - ARRAY['encrypted_payload','payload_purged_at']::text[])) THEN
      RAISE EXCEPTION 'Only terminal job payload erasure is permitted' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('running','cancelled','expired'))
    OR (OLD.state = 'running' AND NEW.state IN ('succeeded','failed','cancelled','expired','uncertain'))
    OR (OLD.state = 'running' AND NEW.state = 'running' AND (
      (NEW.fence = OLD.fence AND NEW.lease_token = OLD.lease_token AND NEW.lease_owner = OLD.lease_owner AND NEW.lease_expires_at = OLD.lease_expires_at)
      OR (NOT OLD.dispatched AND NOT OLD.cancel_requested AND OLD.lease_expires_at <= NEW.updated_at AND NEW.fence = OLD.fence + 1)
    ))
  ) THEN RAISE EXCEPTION 'Illegal job transition' USING ERRCODE = '23514'; END IF;
  IF OLD.dispatched AND NEW.state IN ('queued','cancelled','expired') THEN RAISE EXCEPTION 'Dispatched effects cannot be cancelled or replayed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS control_jobs_immutable ON control_jobs;
CREATE TRIGGER control_jobs_immutable BEFORE UPDATE ON control_jobs FOR EACH ROW EXECUTE FUNCTION control_jobs_guard();

INSERT INTO schema_migrations (version) VALUES ('003_control_plane') ON CONFLICT DO NOTHING;
COMMIT;
