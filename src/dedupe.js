// Fingerprint store with a time window.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { config, paths } from './config.js';

function load(file) {
  if (!existsSync(file)) return { prints: {}, people: {} };
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('[dedupe] fingerprint store unreadable, starting fresh:', err.message);
    return { prints: {}, people: {} };
  }
}

const normMessage = (m) => m.toLowerCase().replace(/\s+/g, ' ').trim();

export function checkDuplicate(id, fields, { file = paths.fingerprints, now = Date.now() } = {}) {
  const person = fields.email || fields.phone;
  if (!person) return { flags: [], duplicate_of: null };
  const store = load(file);
  const windowMs = config.dedupeWindowHours * 3600 * 1000;
  const fp = createHash('sha256').update(`${person}|${normMessage(fields.message)}`).digest('hex');

  const flags = [];
  let duplicate_of = null;
  const seen = store.prints[fp];
  if (seen && seen.id !== id && now - seen.at < windowMs) {
    duplicate_of = seen.id;
    flags.push('duplicate');
  } else {
    const prior = store.people[person];
    if (prior && prior.id !== id && now - prior.at < windowMs) flags.push('repeat_contact');
    store.prints[fp] = { id, at: now };
  }
  store.people[person] = { id, at: now };
  writeFileSync(file, JSON.stringify(store, null, 2));
  return { flags, duplicate_of };
}
