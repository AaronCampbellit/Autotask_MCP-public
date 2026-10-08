BEGIN;
-- Tenant history and filtered history use bounded keyset pagination.
CREATE INDEX IF NOT EXISTS operation_journal_tenant_created_idx ON operation_journal ((split_part(actor_key, ':', 1)), created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS operation_journal_actor_page_idx ON operation_journal (actor_key, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS operation_journal_tenant_action_idx ON operation_journal ((split_part(actor_key, ':', 1)), operation, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS operation_journal_tenant_state_idx ON operation_journal ((split_part(actor_key, ':', 1)), state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS control_audit_tenant_user_idx ON control_audit (tenant_id, actor_key, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS control_audit_tenant_action_idx ON control_audit (tenant_id, action, at DESC, id DESC);
INSERT INTO schema_migrations(version) VALUES ('013_console_history') ON CONFLICT DO NOTHING;
COMMIT;
