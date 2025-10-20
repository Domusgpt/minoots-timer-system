import 'dotenv/config';

import { App, LogLevel } from '@slack/bolt';
import yargsParser from 'yargs-parser';
import { fetch } from 'undici';
import { z } from 'zod';

const REGION_LABEL_KEY = 'minoots.io/region';

const signingSecret = requiredEnv('SLACK_SIGNING_SECRET');
const botToken = requiredEnv('SLACK_BOT_TOKEN');
const apiKey = requiredEnv('MINOOTS_API_KEY');
const tenantId = requiredEnv('MINOOTS_TENANT_ID');
const baseUrl = (process.env.MINOOTS_BASE_URL ?? 'https://api.minoots.com').replace(/\/$/, '');
const defaultRequestedBy = process.env.DEFAULT_REQUESTED_BY ?? 'slack:command';
const defaultRegion = sanitize(process.env.DEFAULT_REGION);
const port = Number(process.env.PORT ?? '4002');

const app = new App({
  signingSecret,
  token: botToken,
  logLevel: LogLevel.INFO,
  port,
});

const commandSchema = z.object({
  duration: z.union([z.string(), z.number()]).optional(),
  fireAt: z.string().optional(),
  name: z.string().optional(),
  region: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  labels: z.record(z.string()).optional(),
  actionBundle: z.record(z.any()).optional(),
  agentBinding: z.record(z.any()).optional(),
  requestedBy: z.string().optional(),
  note: z.string().optional(),
  parserator: z.record(z.any()).optional(),
  reposiologist: z.record(z.any()).optional(),
  nimbusGuardian: z.record(z.any()).optional(),
  clearSeas: z.record(z.any()).optional(),
  ecosystem: z.record(z.any()).optional(),
  ecosystemNarrative: z.string().optional(),
  ecosystemNextSync: z.string().optional(),
});

app.command('/ato', async ({ command, ack, respond, logger }) => {
  await ack();
  try {
    const parsed = parseCommand(command.text ?? '');
    const payload = commandSchema.parse(parsed);

    if (!payload.duration && !payload.fireAt) {
      await respond({
        response_type: 'ephemeral',
        text: 'Please provide either --duration or --fire-at when scheduling a timer.',
      });
      return;
    }

    const labels = { ...(payload.labels ?? {}) };
    const region = payload.region ?? defaultRegion;
    if (region && !labels[REGION_LABEL_KEY]) {
      labels[REGION_LABEL_KEY] = region;
    }

    const metadata = payload.note
      ? { ...(payload.metadata ?? {}), slack_note: payload.note }
      : payload.metadata;

    const body: Record<string, unknown> = {
      tenantId,
      requestedBy: payload.requestedBy ?? defaultRequestedBy,
      name: payload.name ?? `slack-${Date.now()}`,
    };
    if (payload.duration !== undefined) {
      body.duration = payload.duration;
    }
    if (payload.fireAt) {
      body.fireAt = payload.fireAt;
    }
    if (metadata && Object.keys(metadata).length > 0) {
      body.metadata = metadata;
    }
    if (Object.keys(labels).length > 0) {
      body.labels = labels;
    }
    if (payload.actionBundle) {
      body.actionBundle = payload.actionBundle;
    }
    if (payload.agentBinding) {
      body.agentBinding = payload.agentBinding;
    }
    const ecosystem = buildEcosystem(payload);
    if (ecosystem) {
      body.ecosystem = ecosystem;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-api-key': apiKey,
    };
    if (region) {
      headers['x-minoots-region'] = region;
    }

    const response = await fetch(`${baseUrl}/timers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`MINOOTS API returned ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const timerId = (data.id as string | undefined) ?? 'unknown';
    const fireAt = (data.fireAt as string | undefined) ?? payload.fireAt ?? 'unspecified';
    const regionLabel =
      (data.labels && typeof data.labels === 'object' && data.labels !== null
        ? (data.labels as Record<string, unknown>)[REGION_LABEL_KEY]
        : undefined) || region || 'default';

    await respond({
      response_type: 'ephemeral',
      text: `Scheduled timer *${timerId}* (fires at ${fireAt}) in region ${regionLabel}.`,
    });
  } catch (error) {
    logger.error(error);
    await respond({
      response_type: 'ephemeral',
      text: `Failed to schedule timer: ${(error as Error).message}`,
    });
  }
});

(async () => {
  await app.start();
  // eslint-disable-next-line no-console
  console.log(`⚙️  MINOOTS Slack bot listening on port ${port}`);
})();

function parseCommand(text: string) {
  const parsed = yargsParser(text, {
    alias: {
      duration: ['d'],
      fireAt: ['f', 'fire-at'],
      name: ['n'],
      region: ['r'],
      requestedBy: ['requester'],
    },
    configuration: {
      'strip-aliased': true,
      'camel-case-expansion': true,
    },
  });

  const note = Array.isArray(parsed._) ? parsed._.join(' ').trim() : '';

  return {
    duration: parsed.duration,
    fireAt: parsed.fireAt ?? parsed['fire-at'],
    name: parsed.name,
    region: parsed.region,
    requestedBy: parsed.requestedBy,
    metadata: parseJsonObject(parsed.metadata),
    labels: parseLabels(parsed.labels),
    actionBundle: parseJsonObject(parsed['action-bundle']),
    agentBinding: parseJsonObject(parsed['agent-binding']),
    note: note.length > 0 ? note : undefined,
    parserator: parseJsonObject(parsed.parserator),
    reposiologist: parseJsonObject(parsed.reposiologist),
    nimbusGuardian: parseJsonObject(parsed.nimbusGuardian ?? parsed.nimbus),
    clearSeas: parseJsonObject(parsed.clearSeas ?? parsed['clear-seas']),
    ecosystem: parseJsonObject(parsed.ecosystem),
    ecosystemNarrative: parseTextValue(parsed['ecosystem-narrative'] ?? parsed.ecosystemNarrative),
    ecosystemNextSync: parseTextValue(parsed['ecosystem-next-sync'] ?? parsed.ecosystemNextSync),
  };
}

function parseJsonObject(value: unknown): Record<string, any> | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'object') {
    return value as Record<string, any>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, any>) : undefined;
    } catch (error) {
      throw new Error(`Unable to parse JSON value '${value}': ${(error as Error).message}`);
    }
  }
  throw new Error(`Unsupported value type for JSON payload: ${typeof value}`);
}

function parseLabels(value: unknown): Record<string, string> | undefined {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return undefined;
  }
  return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, v]) => {
    if (typeof v === 'string') {
      acc[key] = v;
    }
    return acc;
  }, {});
}

function parseTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type CommandPayload = z.infer<typeof commandSchema>;

function buildEcosystem(payload: CommandPayload): Record<string, unknown> | undefined {
  const base = sanitizeSection(payload.ecosystem);
  const parserator = sanitizeSection(payload.parserator);
  const reposiologist = sanitizeSection(payload.reposiologist);
  const nimbus = sanitizeSection(payload.nimbusGuardian);
  const clearSeas = sanitizeSection(payload.clearSeas);

  const ecosystem: Record<string, unknown> = base ? { ...base } : {};

  if (parserator) {
    ecosystem.parserator = parserator;
  }
  if (reposiologist) {
    ecosystem.reposiologist = reposiologist;
  }
  if (nimbus) {
    ecosystem.nimbusGuardian = nimbus;
  }
  if (clearSeas) {
    ecosystem.clearSeas = clearSeas;
  }
  if (payload.ecosystemNarrative) {
    ecosystem.sharedNarrative = payload.ecosystemNarrative.trim();
  }
  if (payload.ecosystemNextSync) {
    ecosystem.nextSyncIso = payload.ecosystemNextSync.trim();
  }

  return Object.keys(ecosystem).length > 0 ? ecosystem : undefined;
}

function sanitizeSection(value: Record<string, unknown> | undefined | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  const entries = Object.entries(value).reduce<Record<string, unknown>>((acc, [key, raw]) => {
    if (raw === undefined || raw === null) {
      return acc;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        return acc;
      }
      acc[key] = trimmed;
      return acc;
    }
    acc[key] = raw;
    return acc;
  }, {});
  return Object.keys(entries).length > 0 ? entries : undefined;
}

function sanitize(value: string | undefined | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
