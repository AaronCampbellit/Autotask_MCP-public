BEGIN;
ALTER TABLE operation_journal DROP CONSTRAINT IF EXISTS operation_journal_intent_check;
ALTER TABLE operation_journal ADD CONSTRAINT operation_journal_intent_check CHECK (
 (encrypted_intent IS NULL AND intent_expires_at IS NULL)
 OR (encrypted_intent IS NOT NULL AND intent_expires_at IS NOT NULL AND isfinite(intent_expires_at)
 AND operation IN ('ticket_document_work','ticket_handoff','ticket_resolve','service_call_create','sales_opportunities_create','sales_opportunities_update','sales_quotes_create','sales_quotes_update','sales_quoteitems_create','sales_quoteitems_update','sales_quoteitems_delete','sales_companynotes_create','sales_quotelocations_create')
 AND length(encrypted_intent) <= 174806
 AND encrypted_intent ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$')
);
INSERT INTO schema_migrations(version) VALUES('006_sales_intents') ON CONFLICT DO NOTHING;
COMMIT;
