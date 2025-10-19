#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const MinootsSDK = require("../minoots-sdk.js");

function printHelp() {
  console.log(`MINOOTS CLI\n\n` +
    `Usage:\n` +
    `  minoots webhooks list --team <teamId>\n` +
    `  minoots webhooks create --team <teamId> --name <name> --url <url> [--event timer.completed]\n` +
    `  minoots webhooks delete --team <teamId> --webhook <webhookId>\n` +
    `  minoots timers create --team <teamId> --name <name> --duration <duration> [--metadata key=value]\n` +
    `  minoots timers wait --team <teamId> --timer <timerId> [--interval 1000]\n` +
    `  minoots integrations list --team <teamId>\n` +
    `  minoots integrations set --team <teamId> --provider <provider> --config key=value [--config other=value]\n` +
    `  minoots integrations delete --team <teamId> --provider <provider>\n\n` +
    `Environment:\n` +
    `  MINOOTS_API_BASE       Base URL for the MINOOTS API (defaults to https://api.minoots.dev).\n` +
    `  MINOOTS_API_KEY        API key used for authentication (required).\n` +
    `  MINOOTS_FETCH_TIMEOUT  Request timeout in milliseconds (optional).\n` +
    `  MINOOTS_RETRY_ATTEMPTS Number of retry attempts for transient failures (optional).\n` +
    `  MINOOTS_CLI_FETCH      Path to a CommonJS module exporting a fetch function (testing/debug).\n`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { command: "help" };
  }
  const command = args.shift();
  const subcommand = args.shift();
  const options = {};
  while (args.length) {
    const token = args.shift();
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = args.shift();
    if (value == null) {
      throw new Error(`Missing value for --${key}`);
    }
    if (key === "config") {
      if (!options.config) options.config = [];
      options.config.push(value);
    } else if (key === "metadata") {
      if (!options.metadata) options.metadata = [];
      options.metadata.push(value);
    } else {
      options[key] = value;
    }
  }
  return { command, subcommand, options };
}

async function run(argv = process.argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  if (parsed.command === "help") {
    printHelp();
    return;
  }
  const apiKey = process.env.MINOOTS_API_KEY;
  if (!apiKey) {
    console.error("MINOOTS_API_KEY environment variable is required.");
    process.exitCode = 1;
    return;
  }
  const baseURL = process.env.MINOOTS_API_BASE;
  const timeout = process.env.MINOOTS_FETCH_TIMEOUT
    ? Number(process.env.MINOOTS_FETCH_TIMEOUT)
    : undefined;
  const retryAttempts = process.env.MINOOTS_RETRY_ATTEMPTS
    ? Number(process.env.MINOOTS_RETRY_ATTEMPTS)
    : undefined;

  let fetchImpl;
  if (process.env.MINOOTS_CLI_FETCH) {
    try {
      fetchImpl = require(process.env.MINOOTS_CLI_FETCH);
    } catch (err) {
      console.error(`Failed to load custom fetch module at ${process.env.MINOOTS_CLI_FETCH}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    if (typeof fetchImpl !== "function") {
      console.error("Custom fetch module must export a function");
      process.exitCode = 1;
      return;
    }
  }

  const client = new MinootsSDK({
    apiKey,
    baseURL,
    timeout,
    retry: {
      attempts: retryAttempts,
    },
    fetch: fetchImpl,
  });

  const { command, subcommand, options } = parsed;
  try {
    if (command === "webhooks") {
      await handleWebhooks(client, subcommand, options);
    } else if (command === "timers") {
      await handleTimers(client, subcommand, options);
    } else if (command === "integrations") {
      await handleIntegrations(client, subcommand, options);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (err) {
    console.error(err.message);
    if (err.stack) {
      console.debug(err.stack);
    }
    process.exitCode = 1;
  }
}

async function handleWebhooks(client, subcommand, options) {
  const teamId = options.team;
  if (!teamId) throw new Error("--team is required");
  if (subcommand === "list") {
    const result = await client.listWebhooks(teamId);
    console.log(JSON.stringify(result, null, 2));
  } else if (subcommand === "create") {
    const name = options.name;
    const url = options.url;
    const eventType = options.event || "timer.completed";
    if (!name || !url) {
      throw new Error("--name and --url are required for webhook creation");
    }
    const result = await client.createWebhook(teamId, {
      name,
      url,
      eventType,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (subcommand === "delete") {
    const webhookId = options.webhook;
    if (!webhookId) throw new Error("--webhook is required for deletion");
    await client.deleteWebhook(teamId, webhookId);
    console.log(JSON.stringify({ status: "deleted", webhookId }));
  } else {
    throw new Error(`Unknown webhooks subcommand: ${subcommand}`);
  }
}

async function handleIntegrations(client, subcommand, options) {
  const teamId = options.team;
  if (!teamId) throw new Error("--team is required");
  if (subcommand === "list") {
    const result = await client.listIntegrations(teamId);
    console.log(JSON.stringify(result, null, 2));
  } else if (subcommand === "set") {
    const provider = options.provider;
    if (!provider) throw new Error("--provider is required for integrations set");
    const configEntries = options.config || [];
    const config = {};
    for (const entry of configEntries) {
      const [key, value] = entry.split("=");
      if (!key || value === undefined) {
        throw new Error(`Invalid --config entry: ${entry}`);
      }
      config[key] = value;
    }
    if (Object.keys(config).length === 0) {
      throw new Error("At least one --config key=value pair is required");
    }
    const result = await client.upsertIntegration(teamId, provider, config);
    console.log(JSON.stringify(result, null, 2));
  } else if (subcommand === "delete") {
    const provider = options.provider;
    if (!provider) throw new Error("--provider is required for integrations delete");
    await client.deleteIntegration(teamId, provider);
    console.log(JSON.stringify({ status: "deleted", provider }));
  } else {
    throw new Error(`Unknown integrations subcommand: ${subcommand}`);
  }
}

function ensureStateDir() {
  const dir = path.join(process.cwd(), ".minoots");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function handleTimers(client, subcommand, options) {
  const teamId = options.team;
  if (!teamId) throw new Error("--team is required");

  if (subcommand === "create") {
    const duration = options.duration;
    if (!duration) throw new Error("--duration is required for timer creation");
    const name = options.name || `ci_timer_${Date.now()}`;
    const metadataEntries = options.metadata || [];
    const metadata = {};
    for (const entry of metadataEntries) {
      const [key, value] = entry.split("=");
      if (!key || value === undefined) {
        throw new Error(`Invalid --metadata entry: ${entry}`);
      }
      metadata[key] = value;
    }
    const payload = {
      team: teamId,
      name,
      duration,
    };
    if (Object.keys(metadata).length > 0) {
      payload.metadata = metadata;
    }
    const result = await client.createTimer(payload);
    const dir = ensureStateDir();
    if (result && result.timer && result.timer.id) {
      fs.writeFileSync(path.join(dir, "timer-id"), result.timer.id, "utf8");
    }
    fs.writeFileSync(path.join(dir, "timer-create.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } else if (subcommand === "wait") {
    const timerId = options.timer;
    if (!timerId) throw new Error("--timer is required for wait");
    const interval = options.interval ? Number(options.interval) : 1000;
    const timer = await client.pollTimer(timerId, interval);
    const dir = ensureStateDir();
    fs.writeFileSync(path.join(dir, "timer-status.json"), JSON.stringify(timer, null, 2));
    console.log(JSON.stringify({ timerId, status: timer.status, elapsed: timer.elapsed }, null, 2));
  } else {
    throw new Error(`Unknown timers subcommand: ${subcommand}`);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  parseArgs,
};
