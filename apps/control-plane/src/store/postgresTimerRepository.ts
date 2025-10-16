import { Pool } from 'pg';

import { TimerRecord } from '../types/timer';
import { logger } from '../telemetry/logger';
import { TimerRepository } from './timerRepository';

const TABLE = 'timer_records';

const serialize = (timer: TimerRecord) => ({
  ...timer,
  metadata: timer.metadata ?? null,
  labels: timer.labels ?? {},
  actionBundle: timer.actionBundle ?? null,
  agentBinding: timer.agentBinding ?? null,
  firedAt: timer.firedAt ?? null,
  cancelledAt: timer.cancelledAt ?? null,
  cancelReason: timer.cancelReason ?? null,
  cancelledBy: timer.cancelledBy ?? null,
});

const deserialize = (row: any): TimerRecord => ({
  id: row.id,
  tenantId: row.tenant_id,
  requestedBy: row.requested_by,
  name: row.name,
  durationMs: Number(row.duration_ms),
  createdAt: row.created_at,
  fireAt: row.fire_at,
  status: row.status,
  metadata: row.metadata ?? undefined,
  labels: row.labels ?? undefined,
  actionBundle: row.action_bundle ?? undefined,
  agentBinding: row.agent_binding ?? undefined,
  firedAt: row.fired_at ?? undefined,
  cancelledAt: row.cancelled_at ?? undefined,
  cancelReason: row.cancel_reason ?? undefined,
  cancelledBy: row.cancelled_by ?? undefined,
});

export class PostgresTimerRepository implements TimerRepository {
  constructor(private readonly pool: Pool) {}

  async save(timer: TimerRecord): Promise<TimerRecord> {
    const payload = serialize(timer);
    const query = `
      INSERT INTO ${TABLE} (
        tenant_id, id, requested_by, name, duration_ms, created_at, fire_at, status,
        metadata, labels, action_bundle, agent_binding, fired_at, cancelled_at, cancel_reason, cancelled_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16
      )
      ON CONFLICT (tenant_id, id) DO UPDATE SET
        requested_by = EXCLUDED.requested_by,
        name = EXCLUDED.name,
        duration_ms = EXCLUDED.duration_ms,
        created_at = EXCLUDED.created_at,
        fire_at = EXCLUDED.fire_at,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata,
        labels = EXCLUDED.labels,
        action_bundle = EXCLUDED.action_bundle,
        agent_binding = EXCLUDED.agent_binding,
        fired_at = EXCLUDED.fired_at,
        cancelled_at = EXCLUDED.cancelled_at,
        cancel_reason = EXCLUDED.cancel_reason,
        cancelled_by = EXCLUDED.cancelled_by
      RETURNING *
    `;

    const values = [
      payload.tenantId,
      payload.id,
      payload.requestedBy,
      payload.name,
      payload.durationMs,
      payload.createdAt,
      payload.fireAt,
      payload.status,
      payload.metadata,
      payload.labels ?? {},
      payload.actionBundle,
      payload.agentBinding,
      payload.firedAt,
      payload.cancelledAt,
      payload.cancelReason,
      payload.cancelledBy,
    ];

    const result = await this.pool.query(query, values);
    logger.debug({ timerId: payload.id, tenantId: payload.tenantId }, 'Persisted timer record');
    return deserialize(result.rows[0]);
  }

  async update(timer: TimerRecord): Promise<TimerRecord> {
    return this.save(timer);
  }

  async findById(tenantId: string, id: string): Promise<TimerRecord | null> {
    const query = `SELECT * FROM ${TABLE} WHERE tenant_id = $1 AND id = $2 LIMIT 1`;
    const result = await this.pool.query(query, [tenantId, id]);
    if (result.rowCount === 0) {
      return null;
    }
    return deserialize(result.rows[0]);
  }

  async list(tenantId: string): Promise<TimerRecord[]> {
    const query = `SELECT * FROM ${TABLE} WHERE tenant_id = $1 ORDER BY fire_at ASC`;
    const result = await this.pool.query(query, [tenantId]);
    return result.rows.map((row) => deserialize(row));
  }

  async countActive(tenantId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM ${TABLE}
      WHERE tenant_id = $1 AND status IN ('scheduled', 'armed')
    `;
    const result = await this.pool.query(query, [tenantId]);
    const count = result.rows[0]?.count ?? '0';
    return Number(count);
  }
}
