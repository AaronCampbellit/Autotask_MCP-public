BEGIN;
CREATE TABLE rmm_connections(tenant_id text PRIMARY KEY,version integer NOT NULL,payload text NOT NULL);
CREATE TABLE rmm_jobs(id uuid PRIMARY KEY,tenant_id text NOT NULL,actor text NOT NULL,request_key text NOT NULL,payload text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,actor,request_key));
CREATE INDEX rmm_jobs_actor_idx ON rmm_jobs(tenant_id,actor,created_at DESC,id DESC);
CREATE TABLE rmm_audit(id uuid PRIMARY KEY,tenant_id text NOT NULL,actor text NOT NULL,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}'::jsonb,at timestamptz NOT NULL DEFAULT now());
CREATE INDEX rmm_audit_tenant_idx ON rmm_audit(tenant_id,at DESC,id DESC);
INSERT INTO schema_migrations(version) VALUES ('014_rmm');
COMMIT;
