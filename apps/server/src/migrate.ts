import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
export function migrationConnectionString(env:Readonly<Record<string,string|undefined>>=process.env):string {
  const value=env.MIGRATION_DATABASE_URL||env.DATABASE_URL;
  if(!value)throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required.');
  return value;
}
export async function runMigrations(env:Readonly<Record<string,string|undefined>>=process.env):Promise<void>{
const pool = new Pool({ connectionString: migrationConnectionString(env) });
try {
  const directory = 'packages/storage/migrations';
  const migrations = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const exists = await pool.query<{ table_name: string | null }>("SELECT to_regclass('public.schema_migrations')::text AS table_name");
  const applied = exists.rows[0]?.table_name
    ? new Set((await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((row) => row.version))
    : new Set<string>();
  for (const name of migrations) {
    if (applied.has(name.slice(0, -4))) continue;
    await pool.query(await readFile(join(directory, name), 'utf8'));
    process.stdout.write(`Applied ${name}.\n`);
  }
} finally { await pool.end(); }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await runMigrations();
