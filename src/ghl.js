// GoHighLevel: upsert contact, add tags, add note. Contact endpoints only. There is no send function.
import { config } from './config.js';

async function ghl(method, pathname, body) {
  if (!config.ghl.token || !config.ghl.locationId) {
    const err = new Error('GHL_TOKEN or GHL_LOCATION_ID is not set in .env');
    err.status = 401;
    throw err;
  }
  let res;
  try {
    res = await fetch(config.ghl.base + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${config.ghl.token}`,
        Version: config.ghl.version,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`GHL ${method} ${pathname}: network error (${err.message})`);
  }
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`GHL ${method} ${pathname} returned ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.retryAfter = res.headers.get('retry-after');
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export async function upsertContact(f) {
  const body = {
    locationId: config.ghl.locationId,
    ...splitName(f.name),
    name: f.name || undefined,
    email: f.email || undefined,
    phone: f.phone || undefined,
    companyName: f.company || undefined,
    source: 'Website enquiry',
  };
  const out = await ghl('POST', '/contacts/upsert', body);
  const id = out?.contact?.id;
  if (!id) throw new Error('GHL upsert returned no contact id');
  return { id, isNew: Boolean(out.new) };
}

export const addTags = (contactId, tags) => ghl('POST', `/contacts/${contactId}/tags`, { tags });

export async function addNote(contactId, body) {
  const out = await ghl('POST', `/contacts/${contactId}/notes`, { body });
  return out?.note?.id || out?.id || 'created';
}

export const contactUrl = (contactId) =>
  `https://app.gohighlevel.com/v2/location/${config.ghl.locationId}/contacts/detail/${contactId}`;
