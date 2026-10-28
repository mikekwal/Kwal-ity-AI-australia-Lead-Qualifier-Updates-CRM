// Sort prompt, schema check, guardrails. Qualification logic lives in rules.md, not here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { askClaude, fence } from './claude.js';
import { config, paths } from './config.js';

const VERDICTS = ['qualified', 'needs_look', 'not_fit'];
const AI_FLAGS = ['urgent', 'complaint', 'existing_customer', 'ai_instruction'];

const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    reason: { type: 'string' },
    service: { type: 'string' },
    missing_info: { type: 'array', items: { type: 'string' } },
    flags: { type: 'array', items: { type: 'string', enum: AI_FLAGS } },
    confidence: { type: 'number' },
  },
  required: ['verdict', 'reason', 'service', 'missing_info', 'flags', 'confidence'],
};

export function enquiryBlock(f) {
  const domain = f.email.split('@')[1] || 'none';
  return fence(
    [
      `Name: ${f.name || '(not given)'}`,
      `Company: ${f.company || '(not given)'}`,
      `Suburb or postcode: ${f.suburb || '(not given)'}`,
      `Service picked on the form: ${f.service || '(not given)'}`,
      `Email given: ${f.email ? 'yes (domain ' + domain + ')' : 'no'}`,
      `Phone given: ${f.phone ? 'yes' : 'no'}`,
      `Message: ${f.message || '(empty)'}`,
    ].join('\n'),
  );
}

function buildPrompt(lead) {
  const tpl = readFileSync(path.join(paths.prompts, 'sort.md'), 'utf8');
  const rules = readFileSync(paths.rules, 'utf8');
  const sysFlags = [...lead.missing.map((m) => `missing ${m}`), ...lead.flags].join(', ') || 'none';
  return tpl
    .replaceAll('{{BUSINESS_NAME}}', config.businessName)
    .replace('{{RULES}}', rules)
    .replace('{{SYSTEM_FLAGS}}', sysFlags)
    .replace('{{ENQUIRY}}', enquiryBlock(lead.fields));
}

const words = (s) => s.trim().split(/\s+/).filter(Boolean);

export async function sortLead(lead) {
  const prompt = buildPrompt(lead);
  let out;
  try {
    out = await askClaude({ model: config.sortModel, prompt, schema: SCHEMA });
  } catch (err) {
    if (err.code !== 'BAD_JSON') throw err;
    try {
      out = await askClaude({ model: config.sortModel, prompt, schema: SCHEMA });
    } catch (err2) {
      if (err2.code !== 'BAD_JSON') throw err2;
      return { verdict: 'needs_look', reason: 'AI output could not be read', service: 'none', missing_info: [], flags: [], confidence: 0, guardrails: ['unreadable_output'] };
    }
  }

  // Validate and apply guardrails.
  const guardrails = [];
  let verdict = String(out.verdict || '').toLowerCase().trim();
  if (!VERDICTS.includes(verdict)) {
    guardrails.push('unknown_verdict');
    verdict = 'needs_look';
  }
  let reason = String(out.reason || '').trim() || 'No reason given';
  if (words(reason).length > 20) reason = words(reason).slice(0, 20).join(' ');
  const confidence = Number(out.confidence);
  if (verdict === 'qualified' && lead.missing.length) {
    verdict = 'needs_look';
    guardrails.push('missing_required_details');
  }
  if (verdict !== 'needs_look' && !(confidence >= config.confidenceFloor)) {
    guardrails.push(`low_confidence_${Number.isNaN(confidence) ? 'none' : confidence}`);
    verdict = 'needs_look';
  }
  return {
    verdict,
    reason,
    service: String(out.service || 'none'),
    missing_info: Array.isArray(out.missing_info) ? out.missing_info.map(String) : [],
    flags: Array.isArray(out.flags) ? out.flags.filter((x) => AI_FLAGS.includes(x)) : [],
    confidence: Number.isNaN(confidence) ? 0 : confidence,
    guardrails,
  };
}
