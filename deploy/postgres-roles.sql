-- Deployment preparation, executed by the PostgreSQL administrator before migrations.
-- No passwords are embedded. Use psql \password interactively for each LOGIN role,
-- or the approved database/secret-manager provisioning process.
-- Review existing same-named roles before use; this file does not weaken their settings.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autotask_mcp_migrator') THEN
    CREATE ROLE autotask_mcp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'autotask_mcp_app') THEN
    CREATE ROLE autotask_mcp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO autotask_mcp_migrator;
GRANT USAGE ON SCHEMA public TO autotask_mcp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE autotask_mcp_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO autotask_mcp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE autotask_mcp_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO autotask_mcp_app;
-- Covers an existing installation when the migrator already owns its objects.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO autotask_mcp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO autotask_mcp_app;
COMMIT;
