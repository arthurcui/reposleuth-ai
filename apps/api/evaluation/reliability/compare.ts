/** Offline CLI for paired assessed results; never invokes a model or GitHub. */
import { readFileSync } from 'node:fs';

import { compareReliability } from './comparison.js';
try {
  const path = process.argv[2];
  if (!path) throw new Error('Missing result file');
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  console.log(JSON.stringify(compareReliability(value), null, 2));
} catch {
  console.error(
    'Comparison rejected. Supply paired baseline/candidate observations with identical input and settings hashes.',
  );
  process.exitCode = 1;
}
