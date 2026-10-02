import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIGS, runCell, buildCellCommand } from '../runner.mjs';

const events = [{ type: 'thread.started', thread_id: 'own' },
  { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
  { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 3 } }];
const stream = events.map(JSON.stringify).join('\n') + '\n';
const fakeSpawnSource = `export function spawnImpl() {
  const child = new EventEmitter();
  for (const name of ['stdin', 'stdout', 'stderr']) child[name] = new PassThrough();
  queueMicrotask(() => { child.stdout.write(${JSON.stringify(stream)}); child.emit('close', 0); });
  return child;
}`;

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'runner-codex-remote-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, opts: { artifactsDir: path.join(root, 'artifacts'), workspaceRoot: path.join(root, 'workspaces'), sessionsRoot: path.join(root, 'sessions') } };
}

function fakeSpawn(act) {
  return (command, args, options) => {
    assert.equal(command, 'codex');
    const child = new EventEmitter();
    for (const name of ['stdin', 'stdout', 'stderr']) child[name] = new PassThrough();
    queueMicrotask(async () => {
      try { await act?.(options); child.stdout.write(stream); child.emit('close', 0); }
      catch (error) { child.emit('error', error); child.emit('close', 1); }
    });
    return child;
  };
}

const cell = (opts) => ({ task: { id: 'S1', class: 'ROUTINE', prompt: 'Solve' }, configName: 'sol-high', repeat: 1, opts });
function assertRemote(record) {
  assert.equal(record.outcome, 'ok', record.harnessError);
  assert.equal(record.answer, 'ok');
  for (const key of ['contaminated', 'rolloutPath', 'meterUsedPercent', 'meterWindowMinutes']) assert.equal(record[key], null, key);
  assert.deepEqual(record.foreignRollouts, []);
  assert.equal(record.usage.input_tokens, 10);
}

test('gpt-6 Sol/Luna tiers are priced (sol6/luna6 rate families) and retain runner sandbox argv', () => {
  for (const family of ['sol', 'luna']) for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const config = CONFIGS[`${family}6-${effort}`];
    // Priced since 2026-09-28 (quota-rate-table-2026-09-28.json): no capabilityOnly flag.
    assert.deepEqual(config, { backend: 'codex', model: `gpt-6-${family}`, effort });
    const command = buildCellCommand(config, { cwd: '/tmp/cell', mode: 'agentic' }, { prompt: 'Fix' }, null);
    assert.deepEqual(command.args, ['exec', '--json', '-m', `gpt-6-${family}`, '-c', `model_reasoning_effort=${effort}`, '-C', '/tmp/cell', '-s', 'workspace-write', 'Fix']);
  }
  assert.equal(CONFIGS['sol-high'].model, 'gpt-5.6-sol');
  assert.equal(CONFIGS['luna-high'].model, 'gpt-5.6-luna');
});

test('remoteSessions bypasses pre-launch and post-launch local rollout walks', async (t) => {
  for (const poisonBefore of [true, false]) {
    const { opts } = await setup(t);
    if (poisonBefore) await writeFile(opts.sessionsRoot, 'not a directory');
    else await mkdir(opts.sessionsRoot);
    const record = await runCell(cell(opts), { remoteSessions: true, spawnImpl: fakeSpawn(async () => {
      if (!poisonBefore) { await rm(opts.sessionsRoot, { recursive: true }); await writeFile(opts.sessionsRoot, 'not a directory'); }
    }) });
    assertRemote(record);
  }
});

test('remote sessions ignore local own-thread meters and foreign changes; local mode preserves both', async (t) => {
  for (const remoteSessions of [true, false]) {
    const { opts } = await setup(t);
    await mkdir(opts.sessionsRoot);
    const own = path.join(opts.sessionsRoot, 'rollout-date-own.jsonl');
    await writeFile(own, JSON.stringify({ rate_limits: { primary: { used_percent: 42, window_minutes: 300 } } }));
    const record = await runCell(cell(opts), { remoteSessions, spawnImpl: fakeSpawn(() => writeFile(path.join(opts.sessionsRoot, 'rollout-date-foreign.jsonl'), 'foreign')) });
    if (remoteSessions) assertRemote(record);
    else {
      assert.equal(record.outcome, 'ok');
      assert.equal(record.contaminated, true);
      assert.deepEqual(record.foreignRollouts, ['rollout-date-foreign.jsonl']);
      assert.equal(record.rolloutPath, own);
      assert.equal(record.meterUsedPercent, 42);
      assert.equal(record.meterWindowMinutes, 300);
    }
  }
});

test('main threads the loaded spawn module remoteSessions declaration into runCell', async (t) => {
  const { root } = await setup(t);
  const codexHome = path.join(root, 'codex-home');
  await mkdir(codexHome);
  await writeFile(path.join(codexHome, 'sessions'), 'poison local rollout root');
  const hook = path.join(root, 'spawn.mjs');
  await writeFile(hook, `import { EventEmitter } from 'node:events'; import { PassThrough } from 'node:stream';
    export const remoteSessions = true; export const venue = 'test-remote'; ${fakeSpawnSource}`);
  const tasks = path.join(root, 'tasks.json'), out = path.join(root, 'runs.json');
  await writeFile(tasks, JSON.stringify([{ id: 'S1', class: 'ROUTINE', prompt: 'Solve' }]));
  await promisify(execFile)(process.execPath, [new URL('../runner.mjs', import.meta.url).pathname, tasks, out,
    '--configs=sol-high', '--concurrency=1', `--spawn-module=${hook}`], { env: { ...process.env, CODEX_HOME: codexHome } });
  const [record] = JSON.parse(await readFile(out, 'utf8'));
  t.after(() => rm(record.cwd, { recursive: true, force: true }));
  assertRemote(record);
  assert.equal(record.venue, 'test-remote');
});
