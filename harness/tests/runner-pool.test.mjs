import test from 'node:test';
import assert from 'node:assert/strict';
import { runPool } from '../runner.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function waitFor(predicate, timeoutMs = 200) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test('fixed pool preserves array start order and never exceeds its concurrency', async () => {
  const items = [1, 2, 3, 4, 5];
  const starts = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const results = [];

  await runPool(items, async (item) => {
    starts.push(item);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 3));
    inFlight -= 1;
    return item * 10;
  }, { concurrency: 2, onResult: (result) => results.push(result) });

  assert.deepEqual(starts, items);
  assert.deepEqual(results.sort((a, b) => a - b), [10, 20, 30, 40, 50]);
  assert.equal(maxInFlight, 2);
  assert.equal(inFlight, 0);
});

test('raising the target during a poll admits more items without waiting for an in-flight item', async () => {
  const items = [1, 2, 3];
  const jobs = new Map();
  const starts = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let target = 1;

  const pool = runPool(items, (item) => {
    starts.push(item);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const job = deferred();
    jobs.set(item, job);
    return job.promise.finally(() => { inFlight -= 1; });
  }, { concurrency: 1, readTarget: () => target, pollMs: 5 });

  await waitFor(() => starts.length === 1);
  target = 3;
  await waitFor(() => starts.length === 3);
  assert.equal(maxInFlight, 3);
  assert.deepEqual(starts, [1, 2, 3]);

  jobs.get(1).resolve('one');
  jobs.get(2).resolve('two');
  jobs.get(3).resolve('three');
  await pool;
  assert.equal(inFlight, 0);
});

test('lowering the target does not interrupt in-flight items and limits later admissions', async () => {
  const items = [1, 2, 3, 4, 5];
  const jobs = new Map();
  const starts = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let target = 3;

  const pool = runPool(items, (item) => {
    starts.push(item);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const job = deferred();
    jobs.set(item, job);
    return job.promise.finally(() => { inFlight -= 1; });
  }, { concurrency: 3, readTarget: () => target, pollMs: 5 });

  await waitFor(() => starts.length === 3);
  target = 1;
  jobs.get(1).resolve('one');
  jobs.get(2).resolve('two');
  jobs.get(3).resolve('three');
  await waitFor(() => starts.length === 4);
  assert.deepEqual(starts, [1, 2, 3, 4]);
  assert.equal(maxInFlight, 3);

  jobs.get(4).resolve('four');
  await waitFor(() => starts.length === 5);
  assert.deepEqual(starts, [1, 2, 3, 4, 5]);
  assert.equal(inFlight, 1);
  jobs.get(5).resolve('five');
  await pool;
  assert.equal(inFlight, 0);
});

test('invalid targets are ignored and the effective target never falls below one', async () => {
  const jobs = new Map();
  const starts = [];
  const invalidTargets = [0, null, 'not-an-integer', Symbol('invalid')];
  let reads = 0;

  const pool = runPool([1, 2], (item) => {
    starts.push(item);
    const job = deferred();
    jobs.set(item, job);
    return job.promise;
  }, { concurrency: 1, readTarget: () => invalidTargets[Math.min(reads++, invalidTargets.length - 1)], pollMs: 5 });

  await waitFor(() => starts.length === 1);
  jobs.get(1).resolve('one');
  await waitFor(() => starts.length === 2);
  assert.deepEqual(starts, [1, 2]);
  jobs.get(2).resolve('two');
  await pool;
});

test('pool resolves after all results and clears its polling timer', async () => {
  let reads = 0;
  const pool = runPool([1, 2, 3], async (item) => item, {
    concurrency: 2,
    readTarget: () => { reads += 1; return 2; },
    pollMs: 5,
  });

  await pool;
  const readsAtResolve = reads;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads, readsAtResolve);
});
