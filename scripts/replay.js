// npm run replay          re-runs every lead in data/dead/
// npm run replay -- <id>  re-runs one
import { readdirSync } from 'node:fs';
import { ensureDirs, paths } from '../src/config.js';
import { replay } from '../src/pipeline.js';

ensureDirs();
const wanted = process.argv[2];
const ids = wanted ? [wanted] : readdirSync(paths.dead).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
if (!ids.length) console.log('Nothing in data/dead/ to replay.');
for (const id of ids) {
  console.log(`\nReplaying ${id}`);
  await replay(id);
}
