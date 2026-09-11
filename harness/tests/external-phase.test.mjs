import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createExternalPhase } from '../external/phase.mjs';

/* Independent attack map (synthetic temp fixtures; no actual Codex/provider subprocess):
 * - Launch identity: fake runtime supplies real-shaped argv; fake base spawner reads sidecar
 *   synchronously BEFORE returning. Exact argv/hash/model oracles catch late or nominal metadata.
 * - Credential/native boundary: exact forwarded env, secret-free sidecar/result and untouched
 *   native review options catch key mixing and externalizing the fixed reviewer.
 * - Continuation/default reasoning: inspect argv for retained thread/model; NanoGPT's sentinel
 *   effort must be removed from the actual CLI while native and explicit DeepSeek effort remain.
 * - Git check: answer without .git gets opt-out; directory/file .git and writable cells do not.
 * - Accounting: real-shaped cumulative turn.completed events carry a fourth reasoning field;
 *   exact last raw usage catches losing reasoning or summing cumulative snapshots.
 * - Failure classification: known HTTP status text distinguishes provider boundaries from task
 *   errors; original result fields are preserved. Existing runtime tests lack this wrapper seam.
 * - Actual identity: independent session metadata must match requested provider/model; a paired
 *   matching/mismatching verifier catches a completed response from the wrong account route.
 * Gaps: actual CLI acceptance/provider resolution, wire defaults, live tools/continuation,
 * stderr redaction beyond synthetic fixtures and crash durability remain root's live venues.
 */

const DS_MODEL = 'deepseek-v4.1-flash-expires-on-0910';
const DS_ALIAS = 'deepseek-preview-high';
const NANO_ALIAS = 'nanogpt-glm-thinking';
const DS_SECRET = 'synthetic-deepseek-phase-key';
const NANO_SECRET = 'synthetic-nanogpt-phase-key';
const BASE_USAGE = { input_tokens: 31, cached_input_tokens: 11, output_tokens: 19 };
const RESULT = { completed: true, exitCode: 0, timedOut: false, aborted: false,
  errors: [], threadId: 'synthetic-thread', usage: BASE_USAGE, seconds: 4.25,
  final: 'synthetic final', approvalBlocked: false };
const providers = {
  [DS_ALIAS]: { provider: 'deepseek', model: DS_MODEL, effort: 'high', baseUrl: 'https://api.deepseek.com' },
  [NANO_ALIAS]: { provider: 'nanogpt', model: 'z-ai/glm-5.3:thinking', baseUrl: 'https://api.nano-gpt.com/api/v1' },
};
const credentials = { deepseek: DS_SECRET, nanogpt: NANO_SECRET };
const verifyIdentity = async ({ provider, model }) => ({ provider, model });
const spawnOptions = workspace => ({ cwd: workspace, detached: true,
  env: { PATH: '/synthetic/bin', HOME: '/tmp/synthetic-owner', LANG: 'C.UTF-8', TERM: 'dumb' },
  stdio: ['pipe', 'pipe', 'pipe'] });
const argvFor = options => [
  'exec', '--ignore-user-config', '--ignore-rules', '-c', 'sandbox_mode="workspace-write"',
  '-c', `model_reasoning_effort=${JSON.stringify(options.configurations[options.config][1])}`,
  '-C', options.workspace, ...(options.threadId ? ['resume', options.threadId] : []),
  '--json', '-m', options.configurations[options.config][0], '-',
];
const metadataPath = options => path.join(options.cellDir, `${options.name}-provider.json`);

async function environment(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'external-phase-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalogPath = path.join(root, 'catalog.json');
  const catalogBytes = '{"models":[],"synthetic":true}\n';
  await writeFile(catalogPath, catalogBytes);
  const workspace = path.join(root, 'workspace');
  const cellDir = path.join(root, 'cell');
  await mkdir(workspace);
  await mkdir(cellDir);
  const options = { workspace, cellDir, name: 'primary', config: DS_ALIAS,
    configurations: { [DS_ALIAS]: [DS_MODEL, 'high'], [NANO_ALIAS]: ['z-ai/glm-5.3:thinking', 'provider-default'],
      'sol-high': ['gpt-5.6-sol', 'high'] },
    prompt: 'Unchanged synthetic phase prompt\n', readOnly: true, seconds: 47,
    signal: new AbortController().signal, log: () => {}, ...overrides };
  return { root, options, catalogPath, catalogBytes };
}

test('effective provider identity is durable before spawn and omits credentials and environment', async t => {
  const env = await environment(t, { threadId: 'same-thread-for-correction', name: 'correction' });
  const phaseCalls = [];
  const spawnCalls = [];
  const child = { syntheticChild: true };
  let beforeSpawn;
  const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
    spawnChild: (command, argv, options) => {
      spawnCalls.push({ command, argv, options });
      beforeSpawn = JSON.parse(readFileSync(metadataPath(env.options), 'utf8'));
      assert.equal(beforeSpawn.provider, 'deepseek');
      assert.equal(beforeSpawn.model, DS_MODEL);
      assert.equal(beforeSpawn.effort, 'high');
      assert.equal(beforeSpawn.catalogSha256, createHash('sha256').update(env.catalogBytes).digest('hex'));
      assert.deepEqual(beforeSpawn.argv, argv, 'record the effective argv passed to the process');
      assert.deepEqual(options.env, { ...spawnOptions(env.options.workspace).env, DEEPSEEK_API_KEY: DS_SECRET });
      return child;
    },
    runPhase: async options => {
      phaseCalls.push(options);
      assert.equal(options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace)), child);
      return structuredClone(RESULT);
    },
  });
  const returned = await phase(env.options);
  assert.equal(phaseCalls.length, 1);
  assert.equal(spawnCalls.length, 1);
  for (const [key, value] of Object.entries(env.options)) assert.equal(phaseCalls[0][key], value, `preserve ${key}`);
  const actualArgv = spawnCalls[0].argv;
  assert.equal(actualArgv[0], 'exec');
  assert.ok(actualArgv.indexOf('--ignore-user-config') > 1, 'provider overrides belong after exec before original options');
  assert.equal(actualArgv[actualArgv.indexOf('resume') + 1], env.options.threadId);
  assert.equal(actualArgv[actualArgv.indexOf('-m') + 1], DS_MODEL);
  assert.ok(actualArgv.includes('model_reasoning_effort="high"'));
  assert.equal(actualArgv.at(-1), '-');
  assert.deepEqual(returned.providerMetadata, beforeSpawn);
  for (const [key, value] of Object.entries(RESULT)) assert.deepEqual(returned[key], value);
  const metadata = await readFile(metadataPath(env.options), 'utf8');
  for (const secret of [DS_SECRET, NANO_SECRET]) {
    assert.equal(metadata.includes(secret), false);
    assert.equal(JSON.stringify(returned).includes(secret), false);
    assert.equal(JSON.stringify(actualArgv).includes(secret), false);
  }
  assert.equal(Object.hasOwn(beforeSpawn, 'env'), false);
  assert.equal(Object.hasOwn(beforeSpawn, 'credentials'), false);
  assert.equal(Object.hasOwn(beforeSpawn, 'secret'), false);
});

test('native Sol review delegates unchanged options and result without provider metadata or external spawning', async t => {
  const env = await environment(t, { config: 'sol-high', name: 'review' });
  const originalSpawner = () => { throw new Error('Native runtime owns invocation'); };
  env.options.spawnChild = originalSpawner;
  let count = 0;
  const phase = createExternalPhase({ providers, credentials: {}, catalogPath: env.catalogPath,
    verifyIdentity: async () => assert.fail('native review must bypass external identity verification'),
    spawnChild: () => assert.fail('native review must not use external authenticated spawner'),
    runPhase: async options => {
      count += 1;
      assert.deepEqual(options, env.options);
      assert.equal(options.spawnChild, originalSpawner);
      return structuredClone(RESULT);
    },
  });
  assert.deepEqual(await phase(env.options), RESULT);
  assert.equal(count, 1);
  assert.deepEqual(await readdir(env.options.cellDir), []);
});

test('NanoGPT provider-default strips explicit reasoning effort but preserves its model and resumed thread', async t => {
  const env = await environment(t, { config: NANO_ALIAS, threadId: 'nanogpt-continuation' });
  let spawned;
  const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
    spawnChild: (command, argv, options) => { spawned = { command, argv, options }; return {}; },
    runPhase: async options => {
      assert.equal(options.configurations[NANO_ALIAS][1], 'provider-default', 'requested label stays available');
      options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
      return structuredClone(RESULT);
    },
  });
  const returned = await phase(env.options);
  assert.equal(spawned.argv.some(arg => arg.includes('model_reasoning_effort')), false);
  assert.equal(spawned.argv[spawned.argv.indexOf('-m') + 1], 'z-ai/glm-5.3:thinking');
  assert.equal(spawned.argv[spawned.argv.indexOf('resume') + 1], env.options.threadId);
  assert.deepEqual(spawned.options.env, { ...spawnOptions(env.options.workspace).env, NANOGPT_API_KEY: NANO_SECRET });
  assert.equal(returned.providerMetadata.provider, 'nanogpt');
  assert.equal(returned.providerMetadata.effort, null);
});

test('git opt-out applies only to read-only answer workspaces without a .git file or directory', async t => {
  for (const [readOnly, gitShape, expected] of [[true, null, true], [true, 'directory', false], [true, 'file', false], [false, null, false]]) {
    const env = await environment(t, { readOnly });
    if (gitShape === 'directory') await mkdir(path.join(env.options.workspace, '.git'));
    if (gitShape === 'file') await writeFile(path.join(env.options.workspace, '.git'), 'gitdir: /synthetic/separate-metadata\n');
    let argv;
    const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
      spawnChild: (_command, actual) => { argv = actual; return {}; },
      runPhase: async options => {
        options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
        return structuredClone(RESULT);
      },
    });
    await phase(env.options);
    assert.equal(argv.includes('--skip-git-repo-check'), expected, `${readOnly}/${gitShape}`);
    assert.equal(argv.at(-1), '-');
  }
});

test('last cumulative raw usage retains reasoning separately without changing the phase accounting', async t => {
  const env = await environment(t);
  const rawUsage = { ...BASE_USAGE, reasoning_output_tokens: 13 };
  const events = [
    { type: 'turn.completed', usage: { input_tokens: 17, cached_input_tokens: 3, output_tokens: 8, reasoning_output_tokens: 5 } },
    { type: 'turn.completed', usage: rawUsage },
  ];
  const raw = events.map(event => JSON.stringify(event)).join('\n') + '\n';
  const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
    spawnChild: () => ({}),
    runPhase: async options => {
      options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
      await writeFile(path.join(options.cellDir, `${options.name}.jsonl`), raw);
      return structuredClone(RESULT);
    },
  });
  const returned = await phase(env.options);
  assert.deepEqual(returned.usage, BASE_USAGE);
  assert.deepEqual(returned.rawCodexUsage, rawUsage);
  assert.equal(await readFile(path.join(env.options.cellDir, 'primary.jsonl'), 'utf8'), raw);
});

test('a fake phase with no raw stream still preserves its result and leaves raw usage unknown', async t => {
  const env = await environment(t);
  const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
    spawnChild: () => assert.fail('this fake phase does not spawn'),
    runPhase: async () => structuredClone(RESULT),
  });
  const returned = await phase(env.options);
  for (const [key, value] of Object.entries(RESULT)) assert.deepEqual(returned[key], value);
  assert.equal(returned.rawCodexUsage, null);
});

test('known provider HTTP errors add classification without rewriting the original phase failure', async t => {
  for (const [message, expected] of [
    ['unexpected status 401 Unauthorized: Invalid API key', { category: 'authentication', stopScope: 'provider' }],
    ['unexpected status 429 Too Many Requests: daily_usd_limit_exceeded', { category: 'quota', stopScope: 'provider' }],
    ['unexpected status 429 Too Many Requests: rate_limit_exceeded', { category: 'rate-limit', stopScope: 'admission' }],
  ]) {
    const env = await environment(t);
    const failed = { ...structuredClone(RESULT), completed: false, exitCode: 1, errors: [message] };
    const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
      spawnChild: () => ({}),
      runPhase: async options => {
        options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
        return structuredClone(failed);
      },
    });
    const returned = await phase(env.options);
    assert.equal(returned.providerFailure.category, expected.category);
    assert.equal(returned.providerFailure.stopScope, expected.stopScope);
    for (const [key, value] of Object.entries(failed)) assert.deepEqual(returned[key], value);
  }
});

test('ordinary task errors are not reclassified as provider availability failures', async t => {
  const env = await environment(t);
  const failed = { ...structuredClone(RESULT), completed: false, exitCode: 1,
    errors: ['AssertionError: expected task answer 401 but got 429'] };
  const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
    spawnChild: () => ({}),
    runPhase: async options => {
      options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
      return structuredClone(failed);
    },
  });
  const returned = await phase(env.options);
  assert.equal(returned.providerFailure ?? null, null);
  assert.deepEqual(returned.errors, failed.errors);
  assert.equal(returned.exitCode, 1);
});

test('completed output is accepted only when independently observed provider and model both match', async t => {
  for (const observed of [
    { provider: 'deepseek', model: DS_MODEL },
    { provider: 'openai', model: DS_MODEL },
    { provider: 'deepseek', model: 'deepseek-v4-pro' },
  ]) {
    const env = await environment(t);
    let spawned = 0;
    const identityCalls = [];
    const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath,
      spawnChild: () => { spawned += 1; return {}; },
      verifyIdentity: async requested => { identityCalls.push(requested); return observed; },
      runPhase: async options => {
        options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
        return { ...structuredClone(RESULT), startedAt: '2026-09-09T07:00:00.000Z' };
      },
    });
    const returned = await phase(env.options);
    assert.equal(identityCalls.length, 1);
    assert.equal(identityCalls[0].threadId, RESULT.threadId);
    assert.equal(identityCalls[0].provider, 'deepseek');
    assert.equal(identityCalls[0].model, DS_MODEL);
    assert.equal(identityCalls[0].startedAt, '2026-09-09T07:00:00.000Z');
    assert.equal(spawned, 1, 'identity mismatch must never trigger an automatic retry');
    const matches = observed.provider === 'deepseek' && observed.model === DS_MODEL;
    assert.equal(returned.completed, matches);
    if (matches) assert.equal(returned.providerFailure ?? null, null);
    else {
      assert.equal(returned.providerFailure.category, 'identity-mismatch');
      assert.equal(returned.providerFailure.stopScope, 'provider');
    }
    assert.equal(returned.final, RESULT.final, 'retain output even when the route is excluded');
    assert.deepEqual(returned.usage, BASE_USAGE);
  }
});

test('NanoGPT loopback transport is applied before durable effective-argv metadata is written', async t => {
  const env = await environment(t, { config: NANO_ALIAS });
  const transportUrl = 'http://127.0.0.1:43127';
  const before = structuredClone(providers);
  let count = 0;
  let observed;
  const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath, verifyIdentity,
    transportBaseUrls: { nanogpt: transportUrl },
    spawnChild: (_command, argv, options) => {
      count += 1;
      observed = JSON.parse(readFileSync(metadataPath(env.options), 'utf8'));
      assert.deepEqual(observed.argv, argv, 'sidecar already contains the final transport arguments');
      const urls = argv.filter(arg => /^model_providers\..+\.base_url=/.test(arg));
      assert.ok(urls.length > 0);
      assert.equal(JSON.parse(urls.at(-1).slice(urls.at(-1).indexOf('=') + 1)), transportUrl);
      assert.equal(options.env.NANOGPT_API_KEY, NANO_SECRET);
      return {};
    },
    runPhase: async options => {
      options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
      return structuredClone(RESULT);
    },
  });
  const result = await phase(env.options);
  assert.equal(count, 1);
  assert.equal(result.providerMetadata.provider, 'nanogpt');
  assert.equal(result.providerMetadata.model, 'z-ai/glm-5.3:thinking');
  assert.deepEqual(result.providerMetadata, observed);
  assert.deepEqual(providers, before, 'official validated provider configuration stays intact');
  assert.equal(JSON.stringify(observed).includes(NANO_SECRET), false);
});

test('transport overrides reject DeepSeek and nonloopback or decorated NanoGPT URLs before spawning', async t => {
  for (const [config, transportBaseUrls] of [
    [DS_ALIAS, { deepseek: 'http://127.0.0.1:43127' }],
    [NANO_ALIAS, { nanogpt: 'http://example.invalid:43127' }],
    [NANO_ALIAS, { nanogpt: 'http://127.0.0.1.example.invalid:43127' }],
    [NANO_ALIAS, { nanogpt: 'http://0.0.0.0:43127' }],
    [NANO_ALIAS, { nanogpt: 'http://user:synthetic@127.0.0.1:43127' }],
    [NANO_ALIAS, { nanogpt: 'http://127.0.0.1:43127?recipient=other' }],
    [NANO_ALIAS, { nanogpt: 'http://127.0.0.1:43127/other' }],
    [NANO_ALIAS, { nanogpt: 'http://127.0.0.1:43127#other' }],
  ]) {
    const env = await environment(t, { config });
    let count = 0;
    await assert.rejects(async () => {
      const phase = createExternalPhase({ providers, credentials, catalogPath: env.catalogPath,
        verifyIdentity, transportBaseUrls, spawnChild: () => { count += 1; return {}; },
        runPhase: async options => {
          options.spawnChild('codex', argvFor(options), spawnOptions(options.workspace));
          return structuredClone(RESULT);
        },
      });
      await phase(env.options);
    });
    assert.equal(count, 0);
  }
});
