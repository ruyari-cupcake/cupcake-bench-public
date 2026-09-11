import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOwnerScope } from '../../rounds/external-providers-2026-09-09/execution/scope.mjs';

// Owner amendment: cancel V4 Flash/Pro only. Synthetic interleaving tests every preview effort,
// late sweeps, both Nano routes and native reviewer preservation without copying campaign counts.
// Exact cell equality/order and detached nested values catch accidental reindexing or lost repeats.
const PREVIEW = 'deepseek-v4.1-flash-expires-on-0910';
const ds = (model, effort) => ({ provider: 'deepseek', model, effort, baseUrl: 'https://api.deepseek.com' });
function base() {
  const providers = {
    none: ds(PREVIEW, 'none'), low: ds(PREVIEW, 'low'), high: ds(PREVIEW, 'high'), max: ds(PREVIEW, 'max'),
    flash: ds('deepseek-v4-flash', 'high'), pro: ds('deepseek-v4-pro', 'max'),
    nano: { provider: 'nanogpt', model: 'z-ai/glm-5.3', baseUrl: 'https://api.nano-gpt.com/api/v1' },
    thinking: { provider: 'nanogpt', model: 'z-ai/glm-5.3:thinking', baseUrl: 'https://api.nano-gpt.com/api/v1' },
  };
  return { status: 'frozen', reviewer: 'sol-high', limits: { primarySeconds: 2700 }, providers,
    configurations: { ...Object.fromEntries(Object.entries(providers).map(([alias, p]) => [alias, [p.model, p.effort ?? 'provider-default']])), 'sol-high': ['gpt-5.6-sol', 'high'] },
    cells: ['max', 'flash', 'none', 'nano', 'low', 'pro', 'high', 'thinking', 'max'].map((config, index) => ({
      id: `original-id-${index}`, config, task: `task-${index}`, round: index % 2 ? 'round4' : 'round3',
      repeat: index + 1, sweep: index === 8 ? 5 : index % 3, stage: index === 8 ? 'additional' : 'initial',
      metadata: { original: index },
    })),
  };
}

test('keeps all preview efforts/repeats and both Nano routes with exact original IDs and order', () => {
  const original = base();
  const filtered = filterOwnerScope(original);
  assert.equal(filtered.status, 'frozen-owner-amendment');
  assert.deepEqual(filtered.cells, original.cells.filter(cell => !['flash', 'pro'].includes(cell.config)));
  assert.deepEqual(filtered.cells.map(cell => cell.id), ['original-id-0', 'original-id-2', 'original-id-3', 'original-id-4', 'original-id-6', 'original-id-7', 'original-id-8']);
  assert.deepEqual(Object.keys(filtered.providers).sort(), ['none', 'low', 'high', 'max', 'nano', 'thinking'].sort());
  assert.deepEqual(Object.keys(filtered.configurations).sort(), ['none', 'low', 'high', 'max', 'nano', 'thinking', 'sol-high'].sort());
  assert.deepEqual(filtered.configurations['sol-high'], original.configurations['sol-high']);
  assert.equal(filtered.reviewer, 'sol-high');
  for (const alias of Object.keys(filtered.providers)) {
    assert.deepEqual(filtered.providers[alias], original.providers[alias]);
    assert.deepEqual(filtered.configurations[alias], original.configurations[alias]);
  }
});

test('scope filtering deeply detaches retained data and never mutates the frozen original', () => {
  const original = base(); const before = structuredClone(original);
  const filtered = filterOwnerScope(original);
  assert.deepEqual(original, before);
  filtered.cells[0].metadata.original = -1;
  filtered.providers.max.effort = 'changed';
  filtered.configurations['sol-high'][1] = 'changed';
  filtered.limits.primarySeconds = 1;
  assert.deepEqual(original, before);
});

test('unknown model/provider or unresolved cell configuration rejects instead of silently reducing scope', () => {
  for (const mutate of [
    value => { value.providers.high.model = 'deepseek-unknown'; },
    value => { value.providers.nano.provider = 'unknown-provider'; },
    value => { value.providers.nano.model = 'z-ai/glm-unknown'; },
    value => { value.cells[0].config = 'missing-config'; },
  ]) {
    const original = base(); mutate(original); const before = structuredClone(original);
    assert.throws(() => filterOwnerScope(original));
    assert.deepEqual(original, before);
  }
});
