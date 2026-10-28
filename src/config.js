// Settings and keys. Values come from .env; key VALUES are never printed or logged.
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(env.PORT, 3000),
  host: env.HOST || '127.0.0.1',
  businessName: env.BUSINESS_NAME || 'Kwal-ity Electrical',
  countryCode: env.DEFAULT_COUNTRY_CODE || '+61',
  timezone: env.TIMEZONE || 'Australia/Sydney',
  digestHour: num(env.DIGEST_HOUR, 17),
  dedupeWindowHours: num(env.DEDUPE_WINDOW_HOURS, 72),
  confidenceFloor: num(env.CONFIDENCE_FLOOR, 0.7),
  claudeBin: env.CLAUDE_BIN || 'claude',
  sortModel: env.SORT_MODEL || 'haiku',
  draftModel: env.DRAFT_MODEL || 'sonnet',
  claudeTimeoutMs: num(env.CLAUDE_TIMEOUT_MS, 60000),
  ghl: {
    base: 'https://services.leadconnectorhq.com',
    token: (env.GHL_TOKEN || '').trim(),
    locationId: (env.GHL_LOCATION_ID || '').trim(),
    version: env.GHL_API_VERSION || '2021-07-28',
  },
  slack: {
    leads: (env.SLACK_LEADS_WEBHOOK || '').trim(),
    // If only one webhook exists, alerts and the report go to the leads channel.
    alerts: (env.SLACK_ALERTS_WEBHOOK || env.SLACK_LEADS_WEBHOOK || '').trim(),
  },
};

const data = path.join(ROOT, 'data');
export const paths = {
  data,
  inbox: path.join(data, 'inbox'),
  done: path.join(data, 'done'),
  dead: path.join(data, 'dead'),
  sandbox: path.join(data, 'sandbox'),
  log: path.join(data, 'log.jsonl'),
  alerts: path.join(data, 'ALERTS.txt'),
  fingerprints: path.join(data, 'fingerprints.json'),
  lastDigest: path.join(data, 'last-digest.json'),
  rules: path.join(ROOT, 'rules.md'),
  prompts: path.join(ROOT, 'src', 'prompts'),
  public: path.join(ROOT, 'public'),
};

export function ensureDirs() {
  for (const p of [paths.inbox, paths.done, paths.dead, paths.sandbox]) mkdirSync(p, { recursive: true });
}

export const KEY_NAMES = ['GHL_TOKEN', 'GHL_LOCATION_ID', 'SLACK_LEADS_WEBHOOK', 'SLACK_ALERTS_WEBHOOK'];

// Names and filled/empty only. Never the values.
export function keyStatus() {
  return KEY_NAMES.map((name) => ({ name, filled: Boolean(env[name] && env[name].trim()) }));
}

export function envFilesFound() {
  return [
    ['../.env (shared)', path.join(ROOT, '..', '.env')],
    ['.env', path.join(ROOT, '.env')],
  ]
    .filter(([, p]) => existsSync(p))
    .map(([label]) => label);
}
