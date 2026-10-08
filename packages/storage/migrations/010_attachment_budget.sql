BEGIN;

CREATE TABLE IF NOT EXISTS attachment_byte_reservations (
  tenant_id text NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 256),
  reservation_id uuid PRIMARY KEY,
  byte_length bigint NOT NULL CHECK(byte_length BETWEEN 1 AND 7000000),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS attachment_byte_reservations_window_idx
  ON attachment_byte_reservations(tenant_id, reserved_at);

CREATE OR REPLACE FUNCTION attachment_reserve_bytes(target_tenant text, requested bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE used_bytes bigint;
BEGIN
  IF target_tenant IS NULL OR length(target_tenant) NOT BETWEEN 1 AND 256 OR requested NOT BETWEEN 1 AND 7000000 THEN
    RAISE EXCEPTION 'ATTACHMENT_BYTE_INVALID';
  END IF;
  -- Serialize reservations per tenant across application instances.
  PERFORM pg_advisory_xact_lock(hashtextextended(target_tenant, 41010));
  DELETE FROM attachment_byte_reservations WHERE tenant_id=target_tenant AND reserved_at <= clock_timestamp() - interval '5 minutes';
  SELECT COALESCE(sum(byte_length),0) INTO used_bytes FROM attachment_byte_reservations
    WHERE tenant_id=target_tenant AND reserved_at > clock_timestamp() - interval '5 minutes';
  IF used_bytes + requested > 10000000 THEN RAISE EXCEPTION 'ATTACHMENT_BYTE_QUOTA'; END IF;
  INSERT INTO attachment_byte_reservations(tenant_id,reservation_id,byte_length) VALUES(target_tenant,gen_random_uuid(),requested);
END;
$$;

INSERT INTO schema_migrations(version) VALUES('010_attachment_budget') ON CONFLICT DO NOTHING;
COMMIT;
