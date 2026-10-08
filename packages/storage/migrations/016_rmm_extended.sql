BEGIN;
CREATE TABLE rmm_entries(id uuid PRIMARY KEY,tenant_id text NOT NULL,actor text NOT NULL,request_key text NOT NULL,kind text NOT NULL,payload text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,actor,request_key));
CREATE INDEX rmm_entries_actor_kind_idx ON rmm_entries(tenant_id,actor,kind,created_at DESC,id DESC);
INSERT INTO schema_migrations(version) VALUES ('016_rmm_extended');
COMMIT;
