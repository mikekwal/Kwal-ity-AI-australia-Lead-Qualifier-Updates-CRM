// JSONL run log + live events for the behind-the-scenes tracker.
import { appendFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { paths } from './config.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

const history = new Map(); // leadId -> events (for tracker clients that connect late)

export function log(leadId, stage, status, detail = '', extra) {
  const row = { at: new Date().toISOString(), lead: leadId, stage, status, detail, ...extra };
  try {
    appendFileSync(paths.log, JSON.stringify(row) + '\n');
  } catch (err) {
    console.error('[log] could not write log row:', err.message);
  }
  const mark = { start: '..', done: 'ok', skip: '--', retry: '!!', fail: 'XX' }[status] || '  ';
  console.log(`[${mark}] ${leadId}  ${stage.padEnd(9)} ${detail}`);
  if (leadId) {
    const list = history.get(leadId) || [];
    list.push(row);
    history.set(leadId, list);
    if (history.size > 200) history.delete(history.keys().next().value);
  }
  bus.emit('event', row);
  return row;
}

export function eventsFor(leadId) {
  return history.get(leadId) || [];
}
