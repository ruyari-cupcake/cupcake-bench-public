import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runExternalSchedule } from '../external/scheduler.mjs';

const test = (name, body) => nodeTest(name, { timeout: 5000 }, body);

/* Independent RED portfolio: fake cell promises control admission/completion and a fake clock
 * controls stage age. Exact started/result/skipped IDs expose duplication, scope errors and
 * discarded work. Independent CPU/RAM/swap perturbations expose over-admission; worker, abort
 * and event failures expose stop/drain ordering. No processes, API calls or campaign data.
 * Existing per-cell tests do not exercise scheduling. Live sampler accuracy, controller recovery
 * and process cleanup remain separate root venues. Polling is bounded and surfaces rejection early.
 */
const ds = (model, effort = 'high') => ({ provider: 'deepseek', model, effort, baseUrl: 'https://api.deepseek.com' });
const PROVIDERS = {
  flashHigh: ds('deepseek-v4-flash'), flashLow: ds('deepseek-v4-flash', 'low'), proHigh: ds('deepseek-v4-pro'),
  nano: { provider: 'nanogpt', model: 'z-ai/glm-5.3', baseUrl: 'https://api.nano-gpt.com/api/v1' },
};
const POLICY = { stages: [4, 6, 8], minimumStageSeconds: 60, raiseBelowCpuPercent: 65,
  raiseAboveAvailableMiB: 8192, lowerAboveCpuPercent: 85, lowerBelowAvailableMiB: 4096, lowerOnSwapOut: true };
const HEALTHY = { cpuPercent: 30, availableMiB: 12000, swapOutDelta: 0 };
const manifest = (configs = Array(12).fill('flashHigh')) => ({
  cells: configs.map((config, index) => ({ id: `cell-${index}`, config })),
  providers: structuredClone(PROVIDERS), resourcePolicy: structuredClone(POLICY),
});
const success = id => ({ id, outcome: 'ok', syntheticPayload: `retained-${id}` });
const failure = (id, category, stopScope) => ({ id, outcome: 'harness_invalid', providerFailure: { category, stopScope } });

function controlled(t, input = manifest(), overrides = {}) {
  const controller = new AbortController();
  const state = { clock: 0, resources: { ...HEALTHY }, samples: 0, starts: [], active: new Map(),
    events: [], resolved: [], settled: false, outcome: null, automatic: false };
  const runCell = cell => {
    assert.equal(state.starts.includes(cell.id), false, `${cell.id} must execute at most once`);
    state.starts.push(cell.id);
    if (state.automatic) { const result = success(cell.id); state.resolved.push(result); return Promise.resolve(result); }
    return new Promise((resolve, reject) => state.active.set(cell.id, { resolve, reject }));
  };
  const dependencies = { runCell, sample: async () => { state.samples += 1; return { ...state.resources }; },
    recordEvent: async event => { state.events.push(structuredClone(event)); },
    signal: controller.signal, now: () => state.clock, pollMs: 1, ...overrides };
  const completion = Promise.resolve().then(() => runExternalSchedule(input, dependencies)).then(
    value => { state.settled = true; state.outcome = { status: 'fulfilled', value }; return state.outcome; },
    reason => { state.settled = true; state.outcome = { status: 'rejected', reason }; return state.outcome; },
  );
  const finish = (id, result = success(id)) => {
    const pending = state.active.get(id);
    assert.ok(pending, `${id} is running`);
    state.active.delete(id); state.resolved.push(result); pending.resolve(result);
  };
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (predicate()) return;
      if (state.outcome?.status === 'rejected') throw state.outcome.reason;
      if (state.settled) assert.fail(`scheduler completed before ${label}`);
      await delay(1);
    }
    assert.fail(`bounded wait did not observe ${label}`);
  };
  const sampleAgain = async () => {
    const target = state.samples + 2;
    await waitFor(() => state.samples >= target, 'two subsequent resource samples');
    await delay(2);
  };
  const drain = async () => {
    state.automatic = true;
    for (const id of [...state.active.keys()]) finish(id);
    const result = await completion;
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  };
  t.after(async () => {
    controller.abort();
    for (const id of [...state.active.keys()]) finish(id);
    await Promise.race([completion, delay(100)]);
  });
  return { state, controller, completion, finish, waitFor, sampleAgain, drain };
}

test('starts four in order, requires elapsed headroom, then raises one stage at a time', async t => {
  const input = manifest();
  const h = controlled(t, input);
  await h.waitFor(() => h.state.starts.length === 4, 'initial four');
  assert.deepEqual(h.state.starts, input.cells.slice(0, 4).map(cell => cell.id));
  h.state.clock = 59999; await h.sampleAgain();
  assert.equal(h.state.starts.length, 4);
  h.state.clock = 60000;
  await h.waitFor(() => h.state.starts.length === 6, 'second stage');
  assert.equal(h.state.active.size, 6);
  await h.sampleAgain(); assert.equal(h.state.starts.length, 6);
  h.state.clock = 120000;
  await h.waitFor(() => h.state.starts.length === 8, 'third stage');
  const output = await h.drain();
  assert.deepEqual(h.state.starts, input.cells.map(cell => cell.id));
  assert.deepEqual(output.results.map(result => result.id).sort(), input.cells.map(cell => cell.id).sort());
  assert.deepEqual(output.skipped, []);
  assert.equal(new Set(output.results.map(result => result.id)).size, input.cells.length);
  for (const result of output.results) assert.equal(result.syntheticPayload, `retained-${result.id}`);
});

test('CPU, memory and swap each lower admissions while preserving all running cells', async t => {
  for (const resources of [{ ...HEALTHY, cpuPercent: 90 }, { ...HEALTHY, availableMiB: 3000 }, { ...HEALTHY, swapOutDelta: 1 }]) {
    const h = controlled(t);
    await h.waitFor(() => h.state.starts.length === 4, 'initial four');
    h.state.clock = 60000; await h.waitFor(() => h.state.starts.length === 6, 'six running');
    h.state.resources = resources; await h.sampleAgain();
    assert.equal(h.state.active.size, 6); assert.equal(h.state.resolved.length, 0);
    h.finish('cell-0'); await h.sampleAgain(); assert.equal(h.state.starts.length, 6);
    h.finish('cell-1'); await h.sampleAgain(); assert.equal(h.state.starts.length, 6);
    h.finish('cell-2'); await h.waitFor(() => h.state.starts.length === 7, 'refill below four');
    assert.equal(h.state.active.size, 4);
    const output = await h.drain(); assert.equal(output.results.length, 12); assert.deepEqual(output.skipped, []);
  }
});

test('elapsed time without both CPU and memory headroom cannot increase concurrency', async t => {
  for (const resources of [{ ...HEALTHY, cpuPercent: 70 }, { ...HEALTHY, availableMiB: 7000 }]) {
    const h = controlled(t); await h.waitFor(() => h.state.starts.length === 4, 'initial four');
    h.state.clock = 180000; h.state.resources = resources; await h.sampleAgain();
    assert.equal(h.state.starts.length, 4); assert.equal((await h.drain()).results.length, 12);
  }
});

test('provider/model/config stops skip only their future scope and preserve active siblings', async t => {
  const configs = ['flashHigh', 'flashLow', 'proHigh', 'nano', 'flashLow', 'proHigh', 'nano', 'flashHigh'];
  for (const [scope, skipped] of [['provider', ['cell-4', 'cell-5', 'cell-7']], ['model', ['cell-4', 'cell-7']], ['config', ['cell-7']]]) {
    const h = controlled(t, manifest(configs));
    await h.waitFor(() => h.state.starts.length === 4, 'initial mixed-provider cells');
    const category = scope === 'provider' ? 'quota' : scope === 'model' ? 'unavailable' : 'unsupported-setting';
    h.finish('cell-0', failure('cell-0', category, scope));
    const output = await h.drain();
    assert.deepEqual(output.skipped.map(cell => cell.id).sort(), skipped);
    assert.equal(output.results.find(result => result.id === 'cell-0').providerFailure.stopScope, scope);
    for (const id of ['cell-1', 'cell-2', 'cell-3', 'cell-6']) assert.ok(output.results.some(result => result.id === id), `retain ${id}`);
    assert.deepEqual([...output.results.map(result => result.id), ...output.skipped.map(cell => cell.id)].sort(), manifest(configs).cells.map(cell => cell.id).sort());
    assert.equal(h.state.starts.length, configs.length - skipped.length);
    assert.ok(output.stopped.length > 0);
  }
});

test('rate limit lowers admission and retains its invalid record without retry or provider stop', async t => {
  const h = controlled(t); await h.waitFor(() => h.state.starts.length === 4, 'initial four');
  h.state.clock = 60000; await h.waitFor(() => h.state.starts.length === 6, 'six running');
  h.finish('cell-0', failure('cell-0', 'rate-limit', 'admission'));
  await h.sampleAgain(); assert.equal(h.state.starts.length, 6);
  h.finish('cell-1'); await h.sampleAgain(); assert.equal(h.state.starts.length, 6);
  h.finish('cell-2'); await h.waitFor(() => h.state.starts.length === 7, 'refill below four');
  const output = await h.drain();
  assert.equal(output.results.length, 12); assert.deepEqual(output.skipped, []);
  assert.equal(output.results.find(result => result.id === 'cell-0').outcome, 'harness_invalid');
  assert.equal(h.state.starts.filter(id => id === 'cell-0').length, 1);
});

test('worker rejection stops admission, drains other cells and preserves their result events', async t => {
  const h = controlled(t); await h.waitFor(() => h.state.starts.length === 4, 'initial four');
  const pending = h.state.active.get('cell-0'); h.state.active.delete('cell-0');
  pending.reject(new Error('Synthetic cell persistence failed'));
  await delay(5);
  assert.equal(h.state.starts.length, 4); assert.equal(h.state.settled, false);
  for (const id of [...h.state.active.keys()]) h.finish(id);
  const output = await h.completion;
  assert.equal(output.status, 'rejected'); assert.match(output.reason.message, /Synthetic cell persistence failed/);
  assert.equal(h.state.starts.length, 4);
  const retained = h.state.events.filter(event => event.type === 'result');
  for (const id of ['cell-1', 'cell-2', 'cell-3']) assert.ok(retained.some(event => JSON.stringify(event).includes(id)), `persist ${id}`);
});

test('abort stops admission but drains and records active work before rejecting', async t => {
  const h = controlled(t); await h.waitFor(() => h.state.starts.length === 4, 'initial four');
  h.controller.abort(); await delay(5);
  assert.equal(h.state.starts.length, 4); assert.equal(h.state.active.size, 4); assert.equal(h.state.settled, false);
  for (const id of [...h.state.active.keys()]) h.finish(id);
  assert.equal((await h.completion).status, 'rejected'); assert.equal(h.state.starts.length, 4);
  const retained = h.state.events.filter(event => event.type === 'result');
  for (const id of ['cell-0', 'cell-1', 'cell-2', 'cell-3']) assert.ok(retained.some(event => JSON.stringify(event).includes(id)), `persist ${id}`);
});

test('pre-aborted schedule never starts a cell', async () => {
  const controller = new AbortController(); controller.abort(); let starts = 0;
  await assert.rejects(runExternalSchedule(manifest(), { runCell: async () => { starts += 1; },
    sample: async () => HEALTHY, recordEvent: async () => {}, signal: controller.signal, pollMs: 1 }));
  assert.equal(starts, 0);
});

test('failed durable event before first admission prevents paid execution', async () => {
  let starts = 0;
  await assert.rejects(runExternalSchedule(manifest(), {
    runCell: async cell => { starts += 1; return success(cell.id); }, sample: async () => HEALTHY,
    recordEvent: async () => { throw new Error('Synthetic event persistence failed'); }, pollMs: 1,
  }), /Synthetic event persistence failed/);
  assert.equal(starts, 0);
});

test('later durable event failure drains initial work and blocks the next paid start', async t => {
  let failEvents = false;
  const h = controlled(t, manifest(), { recordEvent: async () => {
    if (failEvents) throw new Error('Synthetic later event persistence failed');
  } });
  await h.waitFor(() => h.state.starts.length === 4, 'initial four');
  failEvents = true; h.state.clock = 60000; await delay(5);
  h.finish('cell-0'); await delay(5);
  assert.equal(h.state.starts.length, 4); assert.equal(h.state.settled, false);
  for (const id of [...h.state.active.keys()]) h.finish(id);
  const output = await h.completion;
  assert.equal(output.status, 'rejected'); assert.match(output.reason.message, /Synthetic later event persistence failed/);
});

test('duplicate IDs, unresolved aliases and invalid stages fail before any execution', async () => {
  const invalid = [];
  const duplicate = manifest(); duplicate.cells[1].id = duplicate.cells[0].id; invalid.push(duplicate);
  const unknown = manifest(); unknown.cells[0].config = 'missing-alias'; invalid.push(unknown);
  for (const stages of [[], [4, 4], [4, 0], [4, 3], [4, 6.5]]) {
    const value = manifest(); value.resourcePolicy.stages = stages; invalid.push(value);
  }
  const negative = manifest(); negative.resourcePolicy.minimumStageSeconds = -1; invalid.push(negative);
  for (const input of invalid) {
    let starts = 0;
    await assert.rejects(runExternalSchedule(input, { runCell: async () => { starts += 1; },
      sample: async () => HEALTHY, recordEvent: async () => {}, pollMs: 1 }));
    assert.equal(starts, 0);
  }
});

test('rate-limit cooldown blocks new admissions even at four while existing cells finish normally', async t => {
  const input = manifest();
  input.resourcePolicy.rateLimitCooldownMs = 30000;
  const h = controlled(t, input);
  await h.waitFor(() => h.state.starts.length === 4, 'initial minimum concurrency');
  h.finish('cell-0', failure('cell-0', 'rate-limit', 'admission'));
  await h.sampleAgain();
  assert.equal(h.state.starts.length, 4, 'minimum-stage 429 still blocks replacement admissions');
  assert.equal(h.state.active.size, 3, 'existing cells continue');
  h.state.clock = 29999;
  h.finish('cell-1');
  await h.sampleAgain();
  assert.equal(h.state.starts.length, 4, 'cooldown cannot end one millisecond early');
  assert.equal(h.state.active.size, 2, 'another running cell finishes during cooldown');
  h.state.clock = 30000;
  await h.waitFor(() => h.state.starts.length === 6, 'admissions resume exactly after cooldown');
  assert.equal(h.state.active.size, 4);
  const output = await h.drain();
  assert.equal(output.results.length, input.cells.length);
  assert.deepEqual(output.skipped, []);
  assert.equal(output.results.find(result => result.id === 'cell-0').outcome, 'harness_invalid');
  assert.equal(h.state.starts.filter(id => id === 'cell-0').length, 1, 'the limited attempt is never retried');
});
