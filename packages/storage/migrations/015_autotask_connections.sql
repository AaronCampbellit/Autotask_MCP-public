BEGIN;
CREATE TABLE autotask_connections(tenant_id text PRIMARY KEY,version integer NOT NULL CHECK(version>0),payload text NOT NULL);
CREATE TABLE autotask_connection_audit(id uuid PRIMARY KEY,tenant_id text NOT NULL,actor text NOT NULL,action text NOT NULL,version integer NOT NULL,at timestamptz NOT NULL DEFAULT now());
CREATE INDEX autotask_connection_audit_tenant ON autotask_connection_audit(tenant_id,at DESC,id DESC);
INSERT INTO schema_migrations(version) VALUES ('015_autotask_connections');
COMMIT;
