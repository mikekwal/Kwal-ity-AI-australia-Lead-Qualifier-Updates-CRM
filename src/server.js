// GET / serves the form. POST /enquiry saves first, replies, then processes.
// GET /events/<id> streams that lead's progress to the behind-the-scenes panel.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config, ensureDirs, envFilesFound, keyStatus, paths } from './config.js';
import { bus, eventsFor, log } from './log.js';
import { enqueue, recoverInbox } from './pipeline.js';
import { startDigestSchedule } from './digest.js';

const MAX_BODY = 20 * 1024;
const THANKS = "Thanks, we've got your enquiry";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Enquiry too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parse(body, type = '') {
  if (type.includes('application/json')) return JSON.parse(body || '{}');
  return Object.fromEntries(new URLSearchParams(body));
}

const FIELDS = ['name', 'email', 'phone', 'company', 'suburb', 'service', 'message', 'website', 'elapsed_ms'];

async function intake(req, res) {
  let raw;
  try {
    const parsed = parse(await readBody(req), req.headers['content-type']);
    raw = Object.fromEntries(FIELDS.map((k) => [k, String(parsed[k] ?? '').slice(0, 5000)]));
  } catch (err) {
    res.writeHead(err.status || 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: err.status === 413 ? 'Enquiry too large' : 'Could not read the enquiry' }));
  }
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  const lead = { id, receivedAt: new Date().toISOString(), raw, stages: { intake: 'done' } };
  // Save first, process second.
  writeFileSync(path.join(paths.inbox, `${id}.json`), JSON.stringify(lead, null, 2));
  log(id, 'intake', 'done', `Saved to data/inbox/${id}.json`);

  if ((req.headers.accept || '').includes('application/json')) {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, id, message: THANKS }));
  } else {
    res.writeHead(303, { Location: `/?sent=${id}` });
    res.end();
  }
  setImmediate(() => enqueue(id));
}

function events(req, res, id) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (row) => res.write(`data: ${JSON.stringify(row)}\n\n`);
  eventsFor(id).forEach(send);
  const onEvent = (row) => row.lead === id && send(row);
  bus.on('event', onEvent);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    bus.off('event', onEvent);
    clearInterval(ping);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(path.join(paths.public, 'form.html')));
    }
    if (req.method === 'POST' && url.pathname === '/enquiry') return await intake(req, res);
    const m = url.pathname.match(/^\/events\/([\w-]+)$/);
    if (req.method === 'GET' && m) return events(req, res, m[1]);
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

ensureDirs();
server.listen(config.port, config.host, () => {
  console.log(`\n  ${config.businessName} lead intake agent`);
  console.log(`  Form:     http://localhost:${config.port}/`);
  console.log(`  Settings: ${envFilesFound().join(' + ') || 'none found (using defaults)'}`);
  console.log(`  Keys:     ${keyStatus().map((k) => `${k.name} ${k.filled ? 'set' : 'EMPTY'}`).join(' | ')}\n`);
  const n = recoverInbox();
  if (n) console.log(`  Recovered ${n} unfinished lead(s) from data/inbox/\n`);
  startDigestSchedule();
});
