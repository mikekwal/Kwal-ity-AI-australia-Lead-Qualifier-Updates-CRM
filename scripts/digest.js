// npm run digest: post the lead report to Slack now.
import { ensureDirs } from '../src/config.js';
import { postDigest } from '../src/digest.js';

ensureDirs();
try {
  const p = await postDigest();
  console.log('Report posted to Slack:\n\n' + p.blocks[1].text.text);
} catch (err) {
  console.error('Report failed:', err.message);
  process.exitCode = 1;
}
