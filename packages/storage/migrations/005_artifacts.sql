BEGIN;
CREATE TABLE IF NOT EXISTS artifact_storage_lock (id boolean PRIMARY KEY DEFAULT true CHECK(id));
INSERT INTO artifact_storage_lock(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS artifact_catalog (
  id uuid PRIMARY KEY,
  actor_key text NOT NULL CHECK(length(actor_key) BETWEEN 3 AND 513),
  byte_length bigint NOT NULL CHECK(byte_length BETWEEN 0 AND 7000000),
  state text NOT NULL CHECK(state IN ('pending','ready','deleted')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK(expires_at>created_at),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object' AND record->>'id'=id::text AND record->>'actorKey'=actor_key AND record->>'state'=state
    AND record ?& ARRAY['id','actorKey','resourceId','mappingVersion','policyVersion','scopeHash','ticketId','companyId','kind','collection','mime','bytes','sha256','createdAt','expiresAt','state','source','complete','rows','references']
    AND (record->>'bytes')::bigint=byte_length AND jsonb_array_length(record->'references') BETWEEN 1 AND 1001
    AND (record->>'resourceId')::bigint BETWEEN 1 AND 9007199254740991 AND (record->>'mappingVersion')::bigint BETWEEN 1 AND 9007199254740991
    AND (record->>'ticketId')::bigint BETWEEN 1 AND 9007199254740991 AND (record->>'companyId')::bigint BETWEEN 1 AND 9007199254740991
    AND record->>'scopeHash' ~ '^[a-f0-9]{64}$' AND record->>'sha256' ~ '^[a-f0-9]{64}$'
    AND record->>'kind' IN ('csv','staged_upload') AND record->>'source' IN ('fixture','Autotask','client_upload')
    AND (record->>'createdAt')::timestamptz=created_at AND (record->>'expiresAt')::timestamptz=expires_at)
);
CREATE INDEX IF NOT EXISTS artifact_owner_idx ON artifact_catalog(actor_key,state,created_at);
CREATE INDEX IF NOT EXISTS artifact_expiry_idx ON artifact_catalog(expires_at) WHERE state<>'deleted';
CREATE TABLE IF NOT EXISTS artifact_access_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES artifact_catalog(id),
  actor_key text NOT NULL,
  action text NOT NULL CHECK(action IN ('reserved','ready','downloaded','deleted','expired','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS artifact_access_owner_idx ON artifact_access_events(actor_key,created_at);
CREATE OR REPLACE FUNCTION artifact_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ARTIFACT_AUDIT_IMMUTABLE'; END; $$;
DROP TRIGGER IF EXISTS artifact_audit_no_mutation ON artifact_access_events;
CREATE TRIGGER artifact_audit_no_mutation BEFORE UPDATE OR DELETE ON artifact_access_events FOR EACH ROW EXECUTE FUNCTION artifact_audit_immutable();
CREATE OR REPLACE FUNCTION artifact_reserve(payload jsonb, owner_count integer, owner_bytes bigint, total_bytes bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE own_count bigint; own_size bigint; all_size bigint; requested bigint; owner text;
BEGIN
  IF owner_count NOT BETWEEN 1 AND 100 OR owner_bytes NOT BETWEEN 1 AND 1000000000 OR total_bytes NOT BETWEEN 1 AND 1000000000 OR payload->>'state'<>'pending' THEN RAISE EXCEPTION 'ARTIFACT_INVALID'; END IF;
  PERFORM id FROM artifact_storage_lock WHERE id=true FOR UPDATE;
  requested := (payload->>'bytes')::bigint; owner := payload->>'actorKey';
  SELECT count(*),COALESCE(sum(byte_length),0) INTO own_count,own_size FROM artifact_catalog WHERE actor_key=owner AND state<>'deleted';
  SELECT COALESCE(sum(byte_length),0) INTO all_size FROM artifact_catalog WHERE state<>'deleted';
  IF own_count>=owner_count OR own_size+requested>owner_bytes OR all_size+requested>total_bytes THEN RAISE EXCEPTION 'ARTIFACT_QUOTA'; END IF;
  INSERT INTO artifact_catalog(id,actor_key,byte_length,state,created_at,expires_at,record) VALUES((payload->>'id')::uuid,owner,requested,'pending',(payload->>'createdAt')::timestamptz,(payload->>'expiresAt')::timestamptz,payload);
  INSERT INTO artifact_access_events(artifact_id,actor_key,action) VALUES((payload->>'id')::uuid,owner,'reserved');
END;
$$;
CREATE OR REPLACE FUNCTION artifact_transition(target uuid, owner text, action_name text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE current_state text; next_state text;
BEGIN
  -- Use the same lock order as reservations so deleting an artifact and releasing
  -- its quota cannot race a quota calculation or deadlock the owning row.
  PERFORM id FROM artifact_storage_lock WHERE id=true FOR UPDATE;
  SELECT state INTO current_state FROM artifact_catalog WHERE id=target AND actor_key=owner FOR UPDATE;
  IF current_state IS NULL OR current_state='deleted' OR action_name NOT IN ('ready','downloaded','deleted','expired','failed') THEN RETURN false; END IF;
  IF action_name='ready' AND current_state<>'pending' OR action_name='downloaded' AND current_state<>'ready' THEN RETURN false; END IF;
  next_state := CASE WHEN action_name='ready' THEN 'ready' WHEN action_name='downloaded' THEN current_state ELSE 'deleted' END;
  IF next_state<>current_state THEN UPDATE artifact_catalog SET state=next_state,record=jsonb_set(record,'{state}',to_jsonb(next_state)) WHERE id=target; END IF;
  INSERT INTO artifact_access_events(artifact_id,actor_key,action) VALUES(target,owner,action_name);
  RETURN true;
END;
$$;
INSERT INTO schema_migrations(version) VALUES('005_artifacts') ON CONFLICT DO NOTHING;
COMMIT;
