import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyExternalManifest } from '../external/campaign.mjs';

// Focused controller regression: cardinalities and supplied file hashes do not bind the
// embedded task/config/limits/matrix or prove source-list completeness. The injected canonical
// builder models authoritative reconstruction; real temp bytes exercise hashing. No campaign,
// credential loading, model call, source scan or implementation helper supplies the expected result.
// Production uses buildExternalInventory by default; this public verification seam accepts an
// optional { buildInventory } dependency to keep the boundary test small and deterministic.
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'external-manifest-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'frozen-source.json');
  const bytes = '{"synthetic":"authoritative source"}\n';
  await writeFile(source, bytes);
  const canonical = {
    formatVersion: 1, status: 'planned', root, logbookRoot: path.join(root, 'logbook'),
    evidenceDirectory: path.join(root, 'evidence'), workspaceRoot: path.join(root, 'workspaces'),
    catalogPath: path.join(root, 'catalog.json'),
    tasks: Array.from({ length: 228 }, (_, index) => ({ id: `synthetic-${index}`, mode: 'answer', class: 'ROUTINE', prompt: `Synthetic prompt ${index}` })),
    cells: Array.from({ length: 18744 }, (_, index) => ({ id: `cell-${index}`, round: index < 612 ? 'round4' : 'round3',
      task: `synthetic-${index % 228}`, config: 'preview-high', repeat: 1, stage: 'initial', sweep: Math.floor(index / 228) })),
    providers: { 'preview-high': { provider: 'deepseek', model: 'deepseek-v4.1-flash-expires-on-0910', effort: 'high', baseUrl: 'https://api.deepseek.com' } },
    configurations: { 'preview-high': ['deepseek-v4.1-flash-expires-on-0910', 'high'], 'sol-high': ['gpt-5.6-sol', 'high'] },
    round4Tasks: ['P01', 'P02', 'E01', 'E02', 'E03', 'E04', 'E05', 'E06'],
    reviewer: 'sol-high', maxCorrections: 1, privateTaskVersion: 1, graderRevision: 3,
    limits: { primarySeconds: 2700, reviewSeconds: 600, correctionSeconds: 1200 },
    resourcePolicy: { stages: [4, 6, 8], minimumStageSeconds: 60 },
    sourceFiles: [{ path: source, sha256: createHash('sha256').update(bytes).digest('hex') }],
  };
  const frozen = { ...structuredClone(canonical), status: 'frozen', frozenAt: '2026-09-09T08:00:00.000Z' };
  const buildInventory = async options => {
    assert.deepEqual(options, { root, evidenceDirectory: canonical.evidenceDirectory, workspaceRoot: canonical.workspaceRoot });
    return structuredClone(canonical);
  };
  return { frozen, canonical, source, buildInventory };
}

test('canonical inventory remains accepted and an actual changed source file remains rejected', async t => {
  const { frozen, source, buildInventory } = await fixture(t);
  assert.equal(await verifyExternalManifest(frozen, { buildInventory }), true);
  await writeFile(source, 'changed synthetic source');
  await assert.rejects(verifyExternalManifest(frozen, { buildInventory }), /source|hash|changed/i);
});

for (const [label, mutate] of [
  ['embedded prompt bytes', value => { value.tasks[0].prompt += '\nchanged task'; }],
  ['resolved model/effort', value => { value.configurations['preview-high'][1] = 'max'; }],
  ['phase time limits', value => { value.limits.primarySeconds = 1; }],
  ['count-preserving cell identity', value => { value.cells[700].task = 'unlisted-task'; }],
  ['omitted frozen source inventory', value => { value.sourceFiles = []; }],
]) {
  test(`rejects ${label} drift despite unchanged aggregate counts`, async t => {
    const { frozen, buildInventory } = await fixture(t);
    mutate(frozen);
    assert.equal(frozen.cells.length, 18744);
    assert.equal(frozen.tasks.length, 228);
    assert.equal(frozen.cells.filter(cell => cell.round === 'round4').length, 612);
    await assert.rejects(verifyExternalManifest(frozen, { buildInventory }));
  });
}
