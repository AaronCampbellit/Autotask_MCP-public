BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity_mappings (
  tenant_id text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 256),
  object_id text NOT NULL CHECK (length(object_id) BETWEEN 1 AND 256),
  resource_id bigint NOT NULL CHECK (resource_id > 0 AND resource_id <= 9007199254740991),
  mapping_version integer NOT NULL CHECK (mapping_version > 0),
  policy_version text NOT NULL CHECK (length(policy_version) > 0),
  active boolean NOT NULL DEFAULT false,
  resource_verified_at timestamptz NOT NULL,
  policy jsonb NOT NULL CHECK (
    jsonb_typeof(policy) = 'object'
    AND policy ? 'capabilities' AND jsonb_typeof(policy->'capabilities') = 'array'
    AND policy ? 'companyIds' AND jsonb_typeof(policy->'companyIds') = 'array'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, object_id)
);

-- Durable identity, hashes and redacted receipts only: no titles, notes or API secrets.
CREATE TABLE IF NOT EXISTS operation_journal (
  id uuid PRIMARY KEY,
  actor_key text NOT NULL CHECK (
    actor_key ~ '^[^:[:space:]]+:[^:[:space:]]+$'
    AND length(split_part(actor_key, ':', 1)) <= 256
    AND length(split_part(actor_key, ':', 2)) <= 256
  ),
  request_key text NOT NULL CHECK (length(btrim(request_key)) BETWEEN 1 AND 256),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  mapping_version integer NOT NULL CHECK (mapping_version > 0),
  resource_id bigint NOT NULL CHECK (resource_id > 0 AND resource_id <= 9007199254740991),
  policy_version text NOT NULL CHECK (length(policy_version) BETWEEN 1 AND 256),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN (
    'ready', 'dispatching', 'succeeded_verified', 'accepted_unverified', 'failed', 'unknown_outcome'
  )),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_key, request_key)
);

CREATE INDEX IF NOT EXISTS operation_journal_actor_created_idx
  ON operation_journal (actor_key, created_at DESC);
CREATE INDEX IF NOT EXISTS operation_journal_unresolved_idx
  ON operation_journal (state, updated_at)
  WHERE state IN ('ready', 'dispatching', 'accepted_unverified', 'unknown_outcome');

CREATE OR REPLACE FUNCTION enforce_operation_journal_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.actor_key IS DISTINCT FROM OLD.actor_key
     OR NEW.request_key IS DISTINCT FROM OLD.request_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.mapping_version IS DISTINCT FROM OLD.mapping_version
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Operation identity and intent are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.state = 'ready' AND NEW.state IN ('dispatching', 'failed'))
    OR (OLD.state = 'dispatching' AND NEW.state IN (
      'succeeded_verified', 'accepted_unverified', 'failed', 'unknown_outcome'))
    OR (OLD.state = 'accepted_unverified' AND NEW.state IN (
      'succeeded_verified', 'failed', 'unknown_outcome'))
    OR (OLD.state = 'unknown_outcome' AND NEW.state IN ('succeeded_verified', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Invalid operation state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operation_journal_transition ON operation_journal;
CREATE TRIGGER operation_journal_transition BEFORE UPDATE ON operation_journal
  FOR EACH ROW EXECUTE FUNCTION enforce_operation_journal_transition();

INSERT INTO schema_migrations (version) VALUES ('001_foundation') ON CONFLICT DO NOTHING;

COMMIT;
