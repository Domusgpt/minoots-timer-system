import path from 'node:path';

import { config as loadEnv } from 'dotenv';

import { getPostgresPool, closePostgresPool } from '../src/store/postgresPool';
import { ensurePolicySeeds, loadPolicySeeds } from '../src/policy/seeds';
import { logger } from '../src/telemetry/logger';

const resolveEnvPath = () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  return path.join(repoRoot, '..', '.env');
};

const main = async () => {
  loadEnv({ path: resolveEnvPath(), override: false });
  const pool = getPostgresPool();
  const seeds = loadPolicySeeds();
  await ensurePolicySeeds(pool, seeds);
  logger.info({ tenants: seeds.map((seed) => seed.tenantId) }, 'Policy seed script completed');
};

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[policy:seed] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool().catch((error) => {
      logger.warn({ error }, 'Failed to close Postgres pool after seeding');
    });
  });
