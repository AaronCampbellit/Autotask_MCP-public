BEGIN;
CREATE TABLE durable_read_jobs (
 id uuid PRIMARY KEY, tenant_id text NOT NULL, actor_id text NOT NULL,
 request_key text NOT NULL, input_hash text NOT NULL, company_id bigint NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','completed','failed','cancelled')),
 encrypted_input text NOT NULL, encrypted_result text, error_code text,
 created_ms bigint NOT NULL, updated_ms bigint NOT NULL, expires_ms bigint NOT NULL,
 lease_until_ms bigint NOT NULL DEFAULT 0, lease_owner text, fence bigint NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0, slot integer CHECK(slot BETWEEN 1 AND 4),
 UNIQUE(tenant_id,actor_id,request_key), UNIQUE(tenant_id,actor_id,slot)
);
CREATE INDEX durable_read_jobs_claim ON durable_read_jobs(state,lease_until_ms,created_ms);
CREATE INDEX durable_read_jobs_expiry ON durable_read_jobs(expires_ms);
CREATE TABLE read_selection_handles(id uuid PRIMARY KEY, expires_ms bigint NOT NULL);
CREATE INDEX read_selection_expiry ON read_selection_handles(expires_ms);
INSERT INTO schema_migrations(version) VALUES ('018_durable_read_jobs');
COMMIT;
