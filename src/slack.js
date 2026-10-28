// Slack incoming webhooks: lead card, duplicate line, ops alert, report.
import { appendFileSync } from 'node:fs';
import { config, paths } from './config.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LABEL = { qualified: 'Qualified lead', needs_look: 'Needs a look', not_fit: 'Not a fit' };
const DOT = { qualified: ':large_green_circle:', needs_look: ':large_yellow_circle:', not_fit: ':white_circle:' };

// Readable on the card; GHL keeps the E.164 form. +61491570158 -> +61 491 570 158
export function displayPhone(p) {
  const m = /^\+61(\d{9})$/.exec(p || '');
  if (!m) return p;
  const d = m[1];
  return d[0] === '4' ? `+61 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : `+61 ${d[0]} ${d.slice(1, 5)} ${d.slice(5)}`;
}

export async function post(webhook, payload) {
  if (!webhook) {
    const err = new Error('Slack webhook is not set in .env');
    err.status = 401;
    throw err;
  }
  let res;
  try {
    res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`Slack: network error (${err.message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Slack returned ${res.status}: ${text.slice(0, 120)}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
}

export function leadCard(lead, link) {
  const f = lead.fields;
  const s = lead.sort;
  const flags = [...lead.flags, ...s.flags, ...s.guardrails];
  const missing = [...new Set([...lead.missing, ...s.missing_info])];
  const contact = [f.email, displayPhone(f.phone)].filter(Boolean).join('  ·  ') || 'none given';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${LABEL[s.verdict]}: ${f.name || 'No name'}`.slice(0, 150) } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Contact*\n${esc(contact)}` },
        { type: 'mrkdwn', text: `*Service*\n${esc(s.service)}` },
        { type: 'mrkdwn', text: `*Suburb*\n${esc(f.suburb || 'not given')}` },
        { type: 'mrkdwn', text: `*AI verdict*\n${DOT[s.verdict]} ${LABEL[s.verdict]} (${Math.round(s.confidence * 100)}%)` },
      ],
    },
    { type: 'section', text: { type: 'mrkdwn', text: `*Why:* ${esc(s.reason)}` } },
  ];
  if (flags.length || missing.length) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [flags.length && `*Flags:* ${esc(flags.join(', '))}`, missing.length && `*Missing:* ${esc(missing.join(', '))}`].filter(Boolean).join('\n'),
      },
    });
  }
  if (lead.draft) {
    const draft = lead.draft.length > 2500 ? lead.draft.slice(0, 2500) + '…' : lead.draft;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Suggested reply (draft, not sent)*\n${esc(draft).split('\n').map((l) => '>' + l).join('\n')}` } });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: [link && `<${link}|Open contact in GoHighLevel>`, `Lead ${lead.id}`].filter(Boolean).join('  ·  ') }],
  });
  return { text: `${LABEL[s.verdict]}: ${f.name}`, blocks };
}

export const duplicateLine = (lead, link) => ({
  text: `:repeat: Duplicate enquiry from ${esc(lead.fields.name || 'unknown')} (same as lead ${lead.duplicate_of}). Contact updated, no new draft.${link ? ` <${link}|Open in GoHighLevel>` : ''}`,
});

export async function alertOps(lead, stage, err) {
  const name = lead?.fields?.name || lead?.raw?.name || 'unknown';
  const payload = {
    text: `Lead failed at ${stage}: ${name}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: ':warning: A lead needs attention' } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Lead*\n${esc(name)}` },
          { type: 'mrkdwn', text: `*Stopped at*\n${esc(stage)}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Error*\n\`\`\`${esc(String(err.message).slice(0, 500))}\`\`\`` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Saved safely in data/dead/${lead.id}.json. Nothing is lost. Fix the cause, then run \`npm run replay -- ${lead.id}\`` }] },
    ],
  };
  try {
    await post(config.slack.alerts, payload);
    return true;
  } catch (slackErr) {
    const line = `${new Date().toISOString()} lead=${lead.id} stage=${stage} error=${err.message} (Slack alert failed: ${slackErr.message})\n`;
    appendFileSync(paths.alerts, line);
    console.error('[ALERT] Slack unreachable, wrote to data/ALERTS.txt:', line.trim());
    return false;
  }
}
