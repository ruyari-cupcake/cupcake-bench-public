import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pendingCells } from '../runner.mjs';
import { reclassifyOutcomes } from '../reclassify-outcomes.mjs';

const script = fileURLToPath(new URL('../reclassify-outcomes.mjs', import.meta.url));
const failed = { task: 'S1d', config: 'luna6-low', repeat: 1, outcome: 'model_failure',
  mode: 'answer', exitCode: 1, answer: '', modelOutputObserved: false,
  stderrTail: 'OSError: [Errno 28] No space left on device', usage: { input_tokens: 10 },
  customEvidence: { keep: ['unaltered'] } };
const okay = { ...failed, task: 'S2', outcome: 'ok', exitCode: 0, answer: 'done', stderrTail: '' };

async function setup(t, records = [failed, okay]) {
  const root = await mkdtemp(path.join(tmpdir(), 'bench-reclassify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'runs.json');
  const original = JSON.stringify(records, null, 4) + '\n';
  await writeFile(file, original);
  const incident = path.join(root, 'incident.json');
  return { root, file, original, incident };
}
function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}
async function override(s, entry = { task: failed.task, config: failed.config, repeat: failed.repeat, reason: 'Observed host incident' }) {
  await writeFile(s.incident, JSON.stringify([entry]));
  return `--incident=${s.incident}`;
}

test('reclassifies through current rules, preserves all other fields, and backs up exact original bytes', async (t) => {
  const s = await setup(t);
  const result = run(s.file);
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(await readFile(s.file, 'utf8'));
  assert.deepEqual(rows, [{ ...failed, outcome: 'harness_invalid', reclassifiedFrom: 'model_failure' }, okay]);
  const backups = (await readdir(s.root)).filter((name) => name.startsWith('runs.json.bak-'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(s.root, backups[0]), 'utf8'), s.original);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.changed, 1);
  assert.deepEqual(summary.files[0].changes['model_failure→harness_invalid'], [{ task: failed.task, config: failed.config, repeat: failed.repeat }]);
});

test('unchanged runs are byte-preserved and create no backup', async (t) => {
  const s = await setup(t, [okay, { ...failed, timedOut: true }]);
  const result = run(s.file);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).changed, 0);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.deepEqual(await readdir(s.root), ['runs.json']);
});

test('incident override is exact-keyed, records evidence, and makes the row resumable', async (t) => {
  const source = { ...failed, stderrTail: 'Error: Permission denied (os error 13)\n' };
  const sibling = { ...source, repeat: 2 };
  const s = await setup(t, [source, sibling]);
  const result = run(s.file, await override(s));
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(await readFile(s.file, 'utf8'));
  assert.deepEqual(rows, [{ ...source, outcome: 'harness_invalid', reclassifiedFrom: 'model_failure',
    operatorReclassified: { from: 'model_failure', reason: 'Observed host incident' } }, sibling]);
  const cells = [1, 2].map((repeat) => ({ task: { id: source.task }, configName: source.config, repeat, opts: {} }));
  assert.deepEqual(pendingCells(cells, rows), [cells[0]]);
});

test('incident key may live in any input file, without altering an unrelated file', async (t) => {
  const s = await setup(t, [okay]);
  const second = path.join(s.root, 'second.json');
  await writeFile(second, JSON.stringify([{ ...failed, stderrTail: 'Error: Permission denied (os error 13)' }]));
  const result = run(s.file, second, await override(s));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.equal(JSON.parse(await readFile(second, 'utf8'))[0].outcome, 'harness_invalid');
  assert.equal(JSON.parse(result.stdout).changed, 1);
});

test('absent incident key throws before any file or backup is written, including dry-run', async (t) => {
  const s = await setup(t);
  const flag = await override(s, { task: 'absent', config: failed.config, repeat: 1, reason: 'Evidence' });
  for (const args of [[], ['--dry-run']]) {
    const result = run(s.file, flag, ...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /absent|not found/i);
    assert.equal(await readFile(s.file, 'utf8'), s.original);
    assert.deepEqual((await readdir(s.root)).sort(), ['incident.json', 'runs.json']);
  }
});

test('an incident cannot invalidate an ok record and validation precedes every write', async (t) => {
  const s = await setup(t, [failed]);
  const second = path.join(s.root, 'second.json');
  const original = JSON.stringify([okay]);
  await writeFile(second, original);
  const flag = await override(s, { task: okay.task, config: okay.config, repeat: okay.repeat, reason: 'Wrong target' });
  const result = run(s.file, second, flag);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ok record/i);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.equal(await readFile(second, 'utf8'), original);
  assert.deepEqual((await readdir(s.root)).sort(), ['incident.json', 'runs.json', 'second.json']);
});

test('dry-run reports both classifier and incident changes without writing any bytes', async (t) => {
  const incidentRow = { ...failed, task: 'other', stderrTail: 'Error: Permission denied (os error 13)' };
  const s = await setup(t, [failed, incidentRow, okay]);
  const flag = await override(s, { task: incidentRow.task, config: incidentRow.config, repeat: 1, reason: 'Host evidence' });
  const incidentBytes = await readFile(s.incident, 'utf8');
  const result = run(s.file, flag, '--dry-run');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).changed, 2);
  assert.equal(JSON.parse(result.stdout).dryRun, true);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.equal(await readFile(s.incident, 'utf8'), incidentBytes);
  assert.deepEqual((await readdir(s.root)).sort(), ['incident.json', 'runs.json']);
});

// Survivor challenge: an incident-only/string-specific rewrite is not current-rule re-derivation.
test('re-derives all outcome classes while bound ENOSPC truncations stay failures', async (t) => {
  const records = [
    { ...okay, outcome: 'model_failure' },
    { ...failed, task: 'peek', sensitivePathsAccessed: ['/private/oracle'] },
    { ...failed, task: 'binding', modelBindingValid: false, stderrTail: '', timedOut: true },
    { ...failed, task: 'bound', timedOut: true },
  ];
  const s = await setup(t, records);
  const result = run(s.file);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')), [
    { ...records[0], outcome: 'ok', reclassifiedFrom: 'model_failure' },
    { ...records[1], outcome: 'invalid_peek', reclassifiedFrom: 'model_failure' },
    { ...records[2], outcome: 'harness_invalid', reclassifiedFrom: 'model_failure' }, records[3],
  ]);
});

test('backup failure never overwrites the input or an existing backup', async (t) => {
  const s = await setup(t);
  const timestamp = '2026-09-28T06:00:00.000Z';
  t.mock.method(Date.prototype, 'toISOString', () => timestamp);
  const backup = s.file + '.bak-' + timestamp.replace(/[:.]/g, '-');
  await writeFile(backup, 'previous backup');
  await assert.rejects(reclassifyOutcomes([s.file]), /EEXIST/);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.equal(await readFile(backup, 'utf8'), 'previous backup');
});

test('reapplying an incident keeps original attribution and makes no new backup', async (t) => {
  const source = { ...failed, stderrTail: 'Error: Permission denied (os error 13)' };
  const s = await setup(t, [source]);
  const flag = await override(s);
  const first = run(s.file, flag);
  assert.equal(first.status, 0, first.stderr);
  const before = await readFile(s.file, 'utf8');
  const names = (await readdir(s.root)).sort();
  const second = run(s.file, flag);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).changed, 0);
  assert.equal(await readFile(s.file, 'utf8'), before);
  assert.deepEqual((await readdir(s.root)).sort(), names);
});

// The real main/repeat lane files reuse repeat=1, so an incident key can also name a valid row.
test('an overlapping incident key in another runs file refuses the entire batch', async (t) => {
  const s = await setup(t, [{ ...failed, stderrTail: 'Error: Permission denied (os error 13)' }]);
  const second = path.join(s.root, 'repeat.json');
  const original = JSON.stringify([{ ...okay, task: failed.task }]);
  await writeFile(second, original);
  const result = run(s.file, second, await override(s), '--dry-run');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot override ok record/);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.equal(await readFile(second, 'utf8'), original);
  assert.deepEqual((await readdir(s.root)).sort(), ['incident.json', 'repeat.json', 'runs.json']);
});

const incidentEntry = (scope = {}) => ({ task: failed.task, config: failed.config, repeat: 1, reason: 'Scoped host evidence', ...scope });
const incidentFailure = (label) => ({ ...failed, label, stderrTail: 'Error: Permission denied (os error 13)' });

for (const dryRun of [false, true]) test(`ambiguous unscoped non-ok incident refuses all writes (dryRun=${dryRun})`, async (t) => {
  const s = await setup(t, [incidentFailure('main')]);
  const second = path.join(s.root, 'repeat.json');
  const original = JSON.stringify([incidentFailure('repeat')]);
  await writeFile(second, original);
  await assert.rejects(reclassifyOutcomes([s.file, second], { incident: [incidentEntry()], dryRun }), /ambiguous.*(label|file|scope)/i);
  assert.equal(await readFile(s.file, 'utf8'), s.original);
  assert.equal(await readFile(second, 'utf8'), original);
  assert.deepEqual((await readdir(s.root)).sort(), ['repeat.json', 'runs.json']);
});

for (const scope of [{ label: 'main' }, { file: 'runs.json' }, { label: 'main', file: 'runs.json' }]) {
  test(`incident scope ${JSON.stringify(scope)} preserves nonincident bytes and successful siblings`, async (t) => {
    const source = incidentFailure('main');
    const sibling = incidentFailure('repeat');
    const s = await setup(t, [source, ...(scope.label ? [sibling] : [])]);
    const second = path.join(s.root, 'repeat.json');
    // Same label in a different file discriminates file matching from label inference.
    const original = JSON.stringify([{ ...okay, task: failed.task, label: scope.label && !scope.file ? 'repeat' : 'main' }]);
    await writeFile(second, original);
    const result = await reclassifyOutcomes([s.file, second], { incident: [incidentEntry(scope)] });
    assert.equal(result.changed, 1);
    assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')), [
      { ...source, outcome: 'harness_invalid', reclassifiedFrom: 'model_failure',
        operatorReclassified: { from: 'model_failure', reason: 'Scoped host evidence' } },
      ...(scope.label ? [sibling] : []),
    ]);
    assert.equal(await readFile(second, 'utf8'), original);
    assert.equal((await readdir(s.root)).filter((name) => name.includes('.bak-')).length, 1);
    assert.equal(await readFile(result.files[0].backup, 'utf8'), s.original);
  });
}

test('distinct scoped incidents may share a cell key and retain their separate reasons', async (t) => {
  const s = await setup(t, [incidentFailure('main'), incidentFailure('repeat')]);
  const incident = [incidentEntry({ label: 'main' }), incidentEntry({ label: 'repeat', reason: 'Repeat incident' })];
  const result = await reclassifyOutcomes([s.file, s.file], { incident });
  assert.equal(result.changed, 2);
  assert.deepEqual(JSON.parse(await readFile(s.file, 'utf8')).map((r) => r.operatorReclassified.reason), ['Scoped host evidence', 'Repeat incident']);
});

for (const scope of [{ label: 'absent' }, { file: 'absent.json' }, { label: 'repeat', file: 'runs.json' }]) {
  test(`unmatched scope ${JSON.stringify(scope)} refuses before writing`, async (t) => {
    const s = await setup(t, [incidentFailure('main')]);
    await assert.rejects(reclassifyOutcomes([s.file], { incident: [incidentEntry(scope)] }), /not found/);
    assert.equal(await readFile(s.file, 'utf8'), s.original);
    assert.deepEqual(await readdir(s.root), ['runs.json']);
  });
}

for (const scope of [{ label: '' }, { label: 1 }, { file: '../runs.json' }, { file: '' }]) {
  test(`invalid incident scope ${JSON.stringify(scope)} fails before writes`, async (t) => {
    const s = await setup(t, [incidentFailure('main')]);
    await assert.rejects(reclassifyOutcomes([s.file], { incident: [incidentEntry(scope)] }), /label|file|scope/);
    assert.equal(await readFile(s.file, 'utf8'), s.original);
  });
}
