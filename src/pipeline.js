// Runs one lead at a time through the stages. Each stage is recorded on the lead,
// so a replay resumes where it stopped and never adds a second note or card.
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, paths } from './config.js';
import { log } from './log.js';
import { retry } from './retry.js';
import { validate } from './validate.js';
import { checkDuplicate } from './dedupe.js';
import { sortLead } from './sorter.js';
import { draftReply } from './drafter.js';
import { addNote, addTags, contactUrl, upsertContact } from './ghl.js';
import { alertOps, duplicateLine, leadCard, post } from './slack.js';

const LABEL = { qualified: 'Qualified', needs_look: 'Needs a look', not_fit: 'Not a fit' };
const queue = [];
let running = false;

export function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  if (!running) drain();
}

async function drain() {
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await processLead(id);
    } catch (err) {
      console.error(`[pipeline] unexpected error on ${id}:`, err);
    }
  }
  running = false;
}

const fileIn = (dir, id) => path.join(dir, `${id}.json`);
const save = (lead) => writeFileSync(fileIn(paths.inbox, lead.id), JSON.stringify(lead, null, 2));

async function step(lead, name, fn) {
  if (lead.stages[name]) return;
  log(lead.id, name, 'start');
  const result = await fn();
  lead.stages[name] = result?.skipped ? 'skipped' : 'done';
  save(lead);
  log(lead.id, name, result?.skipped ? 'skip' : 'done', result?.detail || '', result?.link ? { link: result.link } : undefined);
}

const withRetry = (lead, stage, fn) =>
  retry(fn, { onRetry: (n, wait, err) => log(lead.id, stage, 'retry', `Attempt ${n + 1} in ${wait / 1000}s: ${err.message}`) });

export async function processLead(id) {
  const lead = JSON.parse(readFileSync(fileIn(paths.inbox, id), 'utf8'));
  lead.stages ||= {};
  let current = 'validate';
  try {
    current = 'validate';
    await step(lead, 'validate', () => {
      const v = validate(lead.raw);
      Object.assign(lead, { fields: v.fields, missing: v.missing, flags: v.flags });
      const bits = [v.missing.length ? `Missing: ${v.missing.join(', ')}` : 'All required details present', v.flags.length && `Flags: ${v.flags.join(', ')}`];
      return { detail: bits.filter(Boolean).join('. ') };
    });

    current = 'dedupe';
    await step(lead, 'dedupe', () => {
      const d = checkDuplicate(lead.id, lead.fields);
      lead.duplicate_of = d.duplicate_of;
      lead.flags.push(...d.flags);
      if (d.duplicate_of) return { detail: `Duplicate of lead ${d.duplicate_of}` };
      return { detail: d.flags.includes('repeat_contact') ? 'Same person, new message (repeat contact)' : 'New enquiry, not a duplicate' };
    });

    current = 'sort';
    await step(lead, 'sort', async () => {
      lead.sort = await withRetry(lead, 'sort', () => sortLead(lead));
      return { detail: `${LABEL[lead.sort.verdict]}: ${lead.sort.reason}` };
    });

    current = 'draft';
    await step(lead, 'draft', async () => {
      if (lead.sort.verdict === 'not_fit') return { skipped: true, detail: 'Not a fit, so no reply drafted' };
      if (lead.duplicate_of) return { skipped: true, detail: 'Duplicate, so no second draft' };
      lead.draft = await withRetry(lead, 'draft', () => draftReply(lead));
      return { detail: `${lead.draft.split(/\s+/).length} words, saved as a draft. Nothing sent.` };
    });

    current = 'crm';
    await step(lead, 'crm', async () => {
      const f = lead.fields;
      if (!f.email && !f.phone) {
        lead.flags.push('not_filed_no_contact');
        return { skipped: true, detail: 'No email or phone, so not filed (it would create a duplicate contact)' };
      }
      lead.crm ||= {};
      if (!lead.crm.contactId) {
        const c = await withRetry(lead, 'crm', () => upsertContact(f));
        lead.crm.contactId = c.id;
        lead.crm.isNew = c.isNew;
        save(lead);
      }
      if (!lead.crm.tagged) {
        const tags = ['intake-agent', 'source-website', `ai-${lead.sort.verdict.replace('_', '-')}`];
        if (lead.duplicate_of) tags.push('duplicate');
        await withRetry(lead, 'crm', () => addTags(lead.crm.contactId, tags));
        lead.crm.tagged = tags;
        save(lead);
      }
      if (!lead.crm.noteId) {
        lead.crm.noteId = await withRetry(lead, 'crm', () => addNote(lead.crm.contactId, noteBody(lead)));
        save(lead);
      }
      const link = contactUrl(lead.crm.contactId);
      return { detail: `${lead.crm.isNew ? 'New contact created' : 'Existing contact updated'}. Tags: ${lead.crm.tagged.join(', ')}. Note added.`, link };
    });

    current = 'notify';
    await step(lead, 'notify', async () => {
      const link = lead.crm?.contactId ? contactUrl(lead.crm.contactId) : null;
      if (lead.duplicate_of) {
        await withRetry(lead, 'notify', () => post(config.slack.leads, duplicateLine(lead, link)));
        return { detail: 'Short duplicate line posted to Slack' };
      }
      if (lead.sort.verdict === 'not_fit') return { skipped: true, detail: 'Not a fit: no card. It goes in the daily report so a person can overrule it.' };
      await withRetry(lead, 'notify', () => post(config.slack.leads, leadCard(lead, link)));
      return { detail: 'Card posted to the sales channel in Slack' };
    });

    current = 'finish';
    lead.finishedAt = new Date().toISOString();
    writeFileSync(fileIn(paths.done, lead.id), JSON.stringify(lead, null, 2));
    unlinkSync(fileIn(paths.inbox, lead.id));
    log(lead.id, 'finish', 'done', `Filed in data/done/${lead.id}.json`);
  } catch (err) {
    await deadLetter(lead, current, err);
  }
}

async function deadLetter(lead, stage, err) {
  lead.error = { stage, message: err.message, at: new Date().toISOString() };
  writeFileSync(fileIn(paths.dead, lead.id), JSON.stringify(lead, null, 2));
  if (existsSync(fileIn(paths.inbox, lead.id))) unlinkSync(fileIn(paths.inbox, lead.id));
  log(lead.id, stage, 'fail', err.message);
  const sent = await alertOps(lead, stage, err);
  log(lead.id, 'alert', sent ? 'done' : 'fail', sent ? 'Alert posted to the ops channel in Slack' : 'Slack unreachable: alert written to data/ALERTS.txt');
}

function noteBody(lead) {
  const f = lead.fields;
  const s = lead.sort;
  const flags = [...lead.flags, ...s.flags, ...s.guardrails];
  const missing = [...new Set([...lead.missing, ...s.missing_info])];
  const lines = [
    'WEBSITE ENQUIRY (sorted by the intake agent)',
    `Verdict: ${LABEL[s.verdict]} (confidence ${s.confidence})`,
    `Reason: ${s.reason}`,
    `Service: ${s.service}`,
    `Suburb: ${f.suburb || 'not given'}`,
    `Flags: ${flags.join(', ') || 'none'}`,
    `Missing: ${missing.join(', ') || 'none'}`,
    lead.duplicate_of ? `Duplicate of lead: ${lead.duplicate_of}` : null,
    '',
    'Original message:',
    f.message,
  ];
  if (lead.draft) lines.push('', 'SUGGESTED REPLY — DRAFT, NOT SENT', lead.draft);
  return lines.filter((l) => l !== null).join('\n');
}

// Crash recovery: anything left in inbox/ is re-run on start.
export function recoverInbox() {
  const ids = readdirSync(paths.inbox).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  ids.forEach(enqueue);
  return ids.length;
}

// Replay: move a dead lead back to inbox/ and run it again from the stage it reached.
export async function replay(id) {
  renameSync(fileIn(paths.dead, id), fileIn(paths.inbox, id));
  const lead = JSON.parse(readFileSync(fileIn(paths.inbox, id), 'utf8'));
  delete lead.error;
  save(lead);
  log(id, 'replay', 'start', 'Re-running from the stage it reached');
  await processLead(id);
}
