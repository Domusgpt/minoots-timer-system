import { promises as fs } from 'fs';
import path from 'path';

import { Pool } from 'pg';

const MIGRATIONS_TABLE = 'timer_migrations';

const createPool = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to run migrations');
  }
  return new Pool({ connectionString });
};

const loadMigrations = async (directory: string) => {
  const files = await fs.readdir(directory);
  return files
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      name: file,
      path: path.join(directory, file),
    }));
};

const ensureMigrationsTable = async (pool: Pool) => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
};

const hasMigrationRun = async (pool: Pool, name: string): Promise<boolean> => {
  const result = await pool.query(`SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [name]);
  return (result.rowCount ?? 0) > 0;
};

const runMigration = async (pool: Pool, name: string, sql: string) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [name]);
    await client.query('COMMIT');
    console.log(`[db:migrate] Applied ${name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[db:migrate] Failed ${name}`, error);
    throw error;
  } finally {
    client.release();
  }
};

const main = async () => {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const migrations = await loadMigrations(migrationsDir);
  const pool = createPool();
  try {
    await ensureMigrationsTable(pool);
    for (const migration of migrations) {
      if (await hasMigrationRun(pool, migration.name)) {
        continue;
      }
      const sql = await fs.readFile(migration.path, 'utf8');
      await runMigration(pool, migration.name, sql);
    }
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error('[db:migrate] Migration failed', error);
  process.exitCode = 1;
});
