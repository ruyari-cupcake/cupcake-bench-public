import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSegments } from '../src/importer.js';
import { readEvents } from '../src/store.js';

test('importer processes supplied batches', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'batch-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'records');
  assert.equal(await importSegments(fileURLToPath(new URL('../data/samples/', import.meta.url)), file), 6);
  assert.deepEqual((await readEvents(file)).map((row) => row.id), ["e-1", "e-2", "e-3", "e-4", "e-5", "e-6"]);
});
