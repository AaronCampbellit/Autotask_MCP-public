BEGIN;
CREATE TABLE IF NOT EXISTS itglue_connections (tenant_id text PRIMARY KEY, version integer NOT NULL, payload text NOT NULL);
CREATE TABLE IF NOT EXISTS itglue_receipts (id uuid PRIMARY KEY, tenant_id text NOT NULL, actor text NOT NULL, request_key text NOT NULL, payload text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,actor,request_key));
INSERT INTO schema_migrations(version) VALUES ('017_itglue');
COMMIT;
