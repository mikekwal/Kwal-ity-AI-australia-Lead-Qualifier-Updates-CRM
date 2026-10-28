// Draft-reply prompt. The draft is saved for a person to review. Nothing here sends anything.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { askClaude } from './claude.js';
import { config, paths } from './config.js';
import { enquiryBlock } from './sorter.js';

const SCHEMA = { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] };

export async function draftReply(lead) {
  const tpl = readFileSync(path.join(paths.prompts, 'draft.md'), 'utf8');
  let missingList = [...new Set([...lead.missing, ...lead.sort.missing_info])];
  // Urgent or safety jobs: never ask about money first.
  if (lead.sort.flags.includes('urgent')) missingList = missingList.filter((m) => !/budget|price|cost|quote/i.test(m));
  const missing = missingList.join(', ') || 'none';
  const prompt = tpl
    .replaceAll('{{BUSINESS_NAME}}', config.businessName)
    .replace('{{MISSING}}', missing)
    .replace('{{ENQUIRY}}', enquiryBlock(lead.fields));
  const out = await askClaude({ model: config.draftModel, prompt, schema: SCHEMA });
  let reply = String(out.reply || '').trim();
  // Some replies arrive double-wrapped as {"reply": "{\"reply\": ...}"}; unwrap once.
  if (reply.startsWith('{')) {
    try {
      reply = String(JSON.parse(reply).reply || reply).trim();
    } catch {
      /* not JSON after all: keep the text as it is */
    }
  }
  if (!reply) throw new Error('AI returned an empty draft');
  return reply;
}
