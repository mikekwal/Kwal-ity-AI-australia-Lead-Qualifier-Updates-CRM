// npm run check: which keys are filled. Names only, never values.
import { envFilesFound, keyStatus } from '../src/config.js';

console.log(`Settings loaded from: ${envFilesFound().join(' + ') || 'none found'}\n`);
const keys = keyStatus();
for (const k of keys) console.log(`  ${k.filled ? 'set  ' : 'EMPTY'}  ${k.name}`);
const empty = keys.filter((k) => !k.filled).length;
console.log(empty ? `\n${empty} key(s) still empty.` : '\nAll keys set.');
