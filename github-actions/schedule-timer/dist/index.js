#!/usr/bin/env node

const fs = require('node:fs');

const REGION_LABEL_KEY = 'minoots.io/region';

function inputEnvName(name) {
  return `INPUT_${name.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`;
}

function getInput(name, options = {}) {
  const envName = inputEnvName(name);
  const value = process.env[envName];
  if (!value || value.trim().length === 0) {
    if (options.required) {
      throw new Error(`Missing required input '${name}'`);
    }
    return undefined;
  }
  return value.trim();
}

function parseJsonInput(name) {
  const raw = getInput(name);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON for input '${name}': ${error.message}`);
  }
}

async function main() {
  const baseUrl = (getInput('api-base-url') || 'https://api.minoots.com').replace(/\/$/, '');
  const apiKey = getInput('api-key', { required: true });
  const tenantId = getInput('tenant-id', { required: true });
  const requestedBy = getInput('requested-by') || 'github-action';
  const duration = getInput('duration');
  const fireAt = getInput('fire-at');
  const name = getInput('name') || 'github-timer';
  const region = getInput('region');
  const timeoutSeconds = Number(getInput('timeout-seconds') || '10');

  if (!duration && !fireAt) {
    throw new Error("Provide either the 'duration' or 'fire-at' input");
  }

  const metadata = parseJsonInput('metadata');
  const labels = parseJsonInput('labels') || {};
  const actionBundle = parseJsonInput('action-bundle');
  const agentBinding = parseJsonInput('agent-binding');

  if (region && typeof labels === 'object' && labels !== null && !labels[REGION_LABEL_KEY]) {
    labels[REGION_LABEL_KEY] = region;
  }

  const payload = {
    tenantId,
    requestedBy,
    name,
  };

  if (duration) {
    payload.duration = duration;
  }
  if (fireAt) {
    payload.fireAt = fireAt;
  }
  if (metadata) {
    payload.metadata = metadata;
  }
  if (actionBundle) {
    payload.actionBundle = actionBundle;
  }
  if (agentBinding) {
    payload.agentBinding = agentBinding;
  }
  if (labels && Object.keys(labels).length > 0) {
    payload.labels = labels;
  }

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-api-key': apiKey,
  };
  if (region) {
    headers['x-minoots-region'] = region;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  let response;
  try {
    response = await fetch(`${baseUrl}/timers`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`Failed to contact MINOOTS control plane: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`MINOOTS API returned ${response.status}: ${body}`);
  }

  const data = await response.json();
  const timerId = data?.id || data?.timerId || 'unknown';
  const fireAtResponse = data?.fireAt || data?.fire_at_iso || fireAt || null;
  const responseLabels = data?.labels && typeof data.labels === 'object' ? data.labels : {};
  const regionResponse = responseLabels?.[REGION_LABEL_KEY] || region || null;

  const summary = `Scheduled timer ${timerId}` + (fireAtResponse ? ` (fires at ${fireAtResponse})` : '');
  console.log(summary);

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const lines = [
      `timer-id=${timerId}`,
      fireAtResponse ? `fire-at=${fireAtResponse}` : undefined,
      regionResponse ? `region=${regionResponse}` : undefined,
      `response-json=${JSON.stringify(data)}`,
    ].filter(Boolean);
    fs.appendFileSync(outputFile, `${lines.join('\n')}\n`);
  }
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exit(1);
});
