// The report: counts by verdict, failures, and the not-fit list, posted to the ops channel.
// Posts even on a quiet day, so silence itself is a signal.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { post } from './slack.js';
import { retry } from './retry.js';

const readDir = (dir) =>
  existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')))
    : [];

function lastDigest() {
  try {
    return JSON.parse(readFileSync(paths.lastDigest, 'utf8'));
  } catch {
    return { at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), day: null };
  }
}

export function buildDigest(since) {
  const done = readDir(paths.done).filter((l) => l.finishedAt > since);
  const dead = readDir(paths.dead).filter((l) => l.error?.at > since);
  const count = (v) => done.filter((l) => l.sort?.verdict === v).length;
  const notFit = done.filter((l) => l.sort?.verdict === 'not_fit');
  const total = done.length + dead.length;
  const lines = [
    `*${total} lead${total === 1 ? '' : 's'}* since ${new Date(since).toLocaleString('en-AU', { timeZone: config.timezone })}`,
    `:large_green_circle: Qualified: ${count('qualified')}   :large_yellow_circle: Needs a look: ${count('needs_look')}   :white_circle: Not a fit: ${count('not_fit')}   :warning: Failed: ${dead.length}`,
  ];
  if (notFit.length) {
    lines.push('', '*Not a fit (check in case the AI got it wrong):*', ...notFit.map((l) => `• ${l.fields.name || 'No name'}: ${l.sort.reason}`));
  }
  if (dead.length) {
    lines.push('', '*Still waiting in data/dead/ (run `npm run replay`):*', ...dead.map((l) => `• ${l.fields?.name || l.raw?.name || 'No name'}: stopped at ${l.error.stage}`));
  }
  return {
    text: `Lead report: ${total} leads`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${config.businessName}: lead report` } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ],
  };
}

export async function postDigest() {
  const prev = lastDigest();
  const payload = buildDigest(prev.at);
  await retry(() => post(config.slack.alerts, payload));
  const now = new Date();
  writeFileSync(paths.lastDigest, JSON.stringify({ at: now.toISOString(), day: dayIn(now) }));
  return payload;
}

const dayIn = (d) => d.toLocaleDateString('en-CA', { timeZone: config.timezone });
const hourIn = (d) => Number(d.toLocaleString('en-AU', { timeZone: config.timezone, hour: '2-digit', hour12: false }));

export function startDigestSchedule() {
  setInterval(async () => {
    const now = new Date();
    if (hourIn(now) !== config.digestHour || lastDigest().day === dayIn(now)) return;
    try {
      await postDigest();
      console.log('[digest] daily report posted');
    } catch (err) {
      console.error('[digest] daily report failed:', err.message);
    }
  }, 60 * 1000).unref();
}
