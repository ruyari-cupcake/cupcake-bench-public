import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lintDirectory, ALLOWED_LITERALS } from '../../scripts/export-public.mjs';

// The public repo's own URL contains the hosting account name (public by virtue of hosting
// the repo). That exact literal is allowed; the bare account name anywhere else still fails.
test('the public repository URL is allowed while the bare account name still fails the lint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'export-allowed-'));
  try {
    const url = `https://${ALLOWED_LITERALS[0]}`;
    await writeFile(path.join(root, 'ok.md'), `See ${url} for the data.\n`);
    const bare = ALLOWED_LITERALS[0].split('/')[1].split('-')[0];
    await writeFile(path.join(root, 'bad.md'), `Contact ${bare} directly.\n`);
    const hits = await lintDirectory(root);
    assert.deepEqual(hits.map((hit) => hit.file), ['bad.md']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
