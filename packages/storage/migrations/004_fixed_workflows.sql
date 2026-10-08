BEGIN;

-- Expand the fixed workflow roots that can persist encrypted continuation input. Receipts remain text-free.
ALTER TABLE operation_journal ADD COLUMN IF NOT EXISTS encrypted_intent text;
ALTER TABLE operation_journal ADD COLUMN IF NOT EXISTS intent_expires_at timestamptz;

ALTER TABLE operation_journal DROP CONSTRAINT IF EXISTS operation_journal_state_check;
ALTER TABLE operation_journal ADD CONSTRAINT operation_journal_state_check CHECK (
  state IN ('ready', 'dispatching', 'succeeded_verified', 'accepted_unverified', 'failed', 'unknown_outcome')
  OR (state = 'partial' AND operation IN ('ticket_document_work','ticket_handoff','ticket_resolve','service_call_create'))
);
ALTER TABLE operation_journal DROP CONSTRAINT IF EXISTS operation_journal_intent_check;
ALTER TABLE operation_journal ADD CONSTRAINT operation_journal_intent_check CHECK (
  (encrypted_intent IS NULL AND intent_expires_at IS NULL)
  OR (encrypted_intent IS NOT NULL AND intent_expires_at IS NOT NULL
    AND isfinite(intent_expires_at) AND operation IN ('ticket_document_work','ticket_handoff','ticket_resolve','service_call_create')
    AND length(encrypted_intent) <= 174806
    AND encrypted_intent ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$')
);

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
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.encrypted_intent IS DISTINCT FROM OLD.encrypted_intent
     OR NEW.intent_expires_at IS DISTINCT FROM OLD.intent_expires_at THEN
    RAISE EXCEPTION 'Operation identity and intent are immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD.state = 'ready' AND NEW.state IN ('dispatching', 'failed'))
    OR (OLD.state = 'dispatching' AND NEW.state IN (
      'succeeded_verified', 'accepted_unverified', 'failed', 'unknown_outcome'))
    OR (OLD.state = 'accepted_unverified' AND NEW.state IN (
      'succeeded_verified', 'failed', 'unknown_outcome'))
    OR (OLD.state = 'unknown_outcome' AND NEW.state IN ('succeeded_verified', 'failed'))
    OR (OLD.operation IN ('ticket_document_work','ticket_handoff','ticket_resolve','service_call_create') AND (
      (OLD.state = 'dispatching' AND NEW.state IN ('partial', 'dispatching'))
      OR (OLD.state = 'partial' AND NEW.state IN ('dispatching', 'failed'))
      OR (OLD.state IN ('unknown_outcome', 'accepted_unverified') AND NEW.state = 'partial')
    ))
  ) THEN
    RAISE EXCEPTION 'Invalid operation state transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS operation_journal_unresolved_idx;
CREATE INDEX operation_journal_unresolved_idx ON operation_journal (state, updated_at)
  WHERE state IN ('ready', 'dispatching', 'accepted_unverified', 'unknown_outcome', 'partial');

INSERT INTO schema_migrations (version) VALUES ('004_fixed_workflows') ON CONFLICT DO NOTHING;

COMMIT;
