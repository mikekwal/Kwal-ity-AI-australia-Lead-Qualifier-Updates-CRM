// Cleans fields, finds missing details, raises flags (signals, not verdicts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.js';

const BRANDS = JSON.parse(readFileSync(path.join(ROOT, 'src', 'known-brands.json'), 'utf8'));
const FREE_MAIL = new Set([
  'gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.com.au',
  'icloud.com', 'me.com', 'bigpond.com', 'bigpond.net.au', 'proton.me', 'protonmail.com',
]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const FIELDS = ['name', 'email', 'phone', 'company', 'suburb', 'service', 'message'];

export function normalisePhone(raw, countryCode = config.countryCode) {
  if (!raw) return '';
  const plus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const cc = countryCode.replace(/\D/g, '');
  let e164;
  if (plus) e164 = '+' + digits;
  else if (digits.startsWith('00')) e164 = '+' + digits.slice(2);
  else if (digits.startsWith(cc) && digits.length > 9) e164 = '+' + digits;
  else if (digits.startsWith('0')) e164 = '+' + cc + digits.slice(1);
  else e164 = '+' + cc + digits;
  const len = e164.length - 1;
  return len >= 8 && len <= 15 ? e164 : '';
}

export function validate(raw) {
  const f = {};
  for (const k of FIELDS) f[k] = String(raw[k] ?? '').trim();
  f.email = f.email.toLowerCase();
  const phoneGiven = f.phone;
  f.phone = normalisePhone(f.phone);

  const missing = [];
  if (!f.name) missing.push('name');
  if (!f.message) missing.push('message');
  if (!f.email && !f.phone) missing.push('email or phone');

  const flags = [];
  if (f.email && !EMAIL_RE.test(f.email)) flags.push('invalid_email');
  if (phoneGiven && !f.phone) flags.push('invalid_phone');
  const domain = f.email.split('@')[1] || '';
  if (f.company && FREE_MAIL.has(domain)) flags.push('free_mailbox_with_company');
  if (f.message && f.message.length < 15) flags.push('short_message');
  const links = (f.message.match(/https?:\/\/\S+|www\.\S+/gi) || []);
  const linkChars = links.join('').length;
  if (links.length >= 3 || (f.message.length && linkChars / f.message.length > 0.5)) flags.push('mostly_links');
  const text = `${f.company} ${f.message}`.toLowerCase();
  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(text));
  if (brand && domain && !domain.includes(brand)) flags.push('brand_domain_mismatch');
  if (String(raw.website ?? '').trim()) flags.push('honeypot_filled');
  const elapsed = Number(raw.elapsed_ms);
  if (!Number.isNaN(elapsed) && raw.elapsed_ms !== undefined && elapsed < 2000) flags.push('submitted_too_fast');

  return { fields: f, missing, flags };
}
