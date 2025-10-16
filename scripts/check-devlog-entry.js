#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const shouldSkip = () => {
  const flag = process.env.ALLOW_NO_DEVLOG;
  if (!flag) {
    return false;
  }
  return ['1', 'true', 'yes'].includes(flag.toLowerCase());
};

const run = (command) => {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    return '';
  }
};

const resolveDiff = () => {
  const candidates = [];
  if (process.env.DEVLOG_DIFF_BASE) {
    candidates.push(process.env.DEVLOG_DIFF_BASE);
  }
  if (process.env.GITHUB_BASE_REF) {
    candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  }
  candidates.push('origin/main');

  for (const candidate of candidates) {
    const output = run(`git diff --name-only ${candidate}...HEAD`);
    if (output) {
      return output.split(/\r?\n/).filter(Boolean);
    }
  }

  const fallback = run('git diff --name-only HEAD^');
  if (fallback) {
    return fallback.split(/\r?\n/).filter(Boolean);
  }
  return [];
};

const ensureDevlogTouched = (diff) => {
  const hasDevlogChange = diff.some((file) => file.startsWith('docs/devlog/'));
  if (!hasDevlogChange) {
    console.error(
      'Devlog enforcement failed: no files under docs/devlog/ changed in this diff.\n' +
        'Set ALLOW_NO_DEVLOG=1 to bypass in emergencies.',
    );
    process.exit(1);
  }
};

const ensureEntryExists = () => {
  const entry = process.env.DEVLOG_ENTRY;
  if (!entry) {
    return;
  }
  const resolved = path.resolve(entry);
  if (!fs.existsSync(resolved)) {
    console.error(`Devlog entry ${entry} does not exist.`);
    process.exit(1);
  }
  const content = fs.readFileSync(resolved, 'utf8').trim();
  if (!content) {
    console.error(`Devlog entry ${entry} is empty.`);
    process.exit(1);
  }
};

if (shouldSkip()) {
  process.exit(0);
}

const diff = resolveDiff();
ensureDevlogTouched(diff);
ensureEntryExists();
console.log('Devlog check passed.');
