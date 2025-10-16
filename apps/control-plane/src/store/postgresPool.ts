import { Pool, PoolConfig } from 'pg';

import { logger } from '../telemetry/logger';

let pool: Pool | undefined;

export const getPostgresPool = (): Pool => {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured for PostgresTimerRepository');
  }

  const config: PoolConfig = {
    connectionString,
    max: parseInt(process.env.PGPOOL_MAX ?? '10', 10),
    idleTimeoutMillis: parseInt(process.env.PGPOOL_IDLE_TIMEOUT ?? '30000', 10),
  };

  pool = new Pool(config);
  pool.on('error', (error) => {
    logger.error({ error }, 'Unexpected Postgres client error');
  });
  logger.info({ host: process.env.PGHOST ?? 'localhost' }, 'Initialized Postgres connection pool');
  return pool;
};

export const closePostgresPool = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
};
