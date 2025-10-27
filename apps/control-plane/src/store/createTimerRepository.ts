import { PostgresTimerRepository } from './postgresTimerRepository';
import { getPostgresPool } from './postgresPool';
import { InMemoryTimerRepository } from './inMemoryTimerRepository';
import { TimerRepository } from './timerRepository';

export const createTimerRepository = (): TimerRepository => {
  const mode = process.env.TIMER_REPOSITORY_MODE ?? (process.env.DATABASE_URL ? 'postgres' : 'memory');
  if (mode === 'postgres') {
    return new PostgresTimerRepository(getPostgresPool());
  }
  return new InMemoryTimerRepository();
};
