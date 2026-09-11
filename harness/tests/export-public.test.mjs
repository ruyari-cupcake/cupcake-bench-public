import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/export-public.mjs', import.meta.url));
// The exporter is itself published. Escaped identity examples retain the test
// inputs without planting private literal strings in its public source tree.
const host = '/home/' + 'cupcake';
const uuid = ['01a07c99', '1234', '7abc', '8def', '123456789abc'].join('-');
const v4 = ['a1b2c3d4', '1234', '4567', '89ab', '0123456789ab'].join('-');
const round = 'round-test';
const mainRun = `rounds/${round}/evidence/main-run`;
const api = await import(script).catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL(`file://${script}`).href) return {};
  throw error;
});

function requireApi(name) {
  assert.equal(typeof api[name], 'function', `public export must implement ${name}`);
  return api[name];
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'public-export-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const out = path.join(root, 'out');
  await mkdir(sourceRoot);
  // Only the disposable source fixture uses git; neither the real source nor
  // any export output is initialized or committed by this test.
  execFileSync('git', ['init', '-q', sourceRoot]);
  execFileSync('git', ['-C', sourceRoot, '-c', 'user.name=Benchmark Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture']);
  const put = async (relative, text = 'public\n') => {
    const target = path.join(sourceRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  };
  // Task content is opt-in: an unlisted fixture directory does not export. These tests use two.
  // Task modules are opt-in exactly like fixture directories, so the sample round declares its
  // own the way a real one does. Dropping `tasks` here would withhold T2.mjs, which is the
  // point of the gate.
  await put('harness/fixtures/PUBLIC.json', JSON.stringify({ fixtures: ['example', 'T2'], tasks: ['T2'] }));
  // Every round declares what it publishes; the fixture round declares the layout these tests
  // exercise. Without a contract an export refuses, which is its own test below.
  await put(`rounds/${round}/export.json`, JSON.stringify({
    formatVersion: 1,
    publish: true,
    include: ['public/**',
      'evidence/main-run/{metrics.json,report-tables.md,report-summary.md,tasks-main.json}',
      'evidence/main-run/quota-rate-table-*.json',
      'evidence/main-run/ids-*.txt',
      'evidence/main-run/runs-*-{fast,lunamax}.json',
      'evidence/main-run/mechanical-*.json',
      'evidence/main-run/runs-*.artifacts-*/**'],
  }));
  return { root, sourceRoot, out, put, round };
}

async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(root, entry.name), relative + '/'));
    else result.push(relative);
  }
  return result.sort();
}

for (const [name, input, expected, rule] of [
  ['home prefix', `${host}/project/x ${host}/second`, '/home/<user>/project/x /home/<user>/second', 'home'],
  ['workspace segment', '/tmp/cupcake-bench-workspaces/cell-A/src/x.js /tmp/cupcake-bench-workspaces/cell-B', '<ws>/src/x.js <ws>', 'workspace'],
  ['UUID variants', `${uuid} ${v4}`, '<id> <id>', 'uuid'],
  ['snapshot paths', `${host}/.codex/${'shell_' + 'snapshots'}/${uuid}.123.sh ~/.codex/${'shell_' + 'snapshots'}/snapshot.sh`, '<id> <id>', 'snapshot'],
  ['snapshot filename', `${uuid}.1788780843867055667.sh`, '<id>', 'snapshot'],
]) {
  test(`masking replaces ${name} and records counts`, () => {
    const result = requireApi('maskText')(input, `${mainRun}/runs-lane-fast.json`);
    assert.equal(result.text, expected);
    assert.equal(result.counts[rule], name === 'snapshot filename' ? 1 : 2);
  });
}

test('UUID masking preserves task data and model/task/env identifiers, but masks recorded test streams', () => {
  const mask = requireApi('maskText');
  const preserved = `${uuid} gpt-5.6-luna gpt-6-astra claude-opus-5 T2b CODEX_HOME CODEX_THREAD_ID`;
  for (const relative of ['harness/tasks/T2.mjs', 'harness/fixtures/T2/base-src/data.json', 'harness/fixtures/T2/hidden-tests/test.mjs', 'harness/lib/example.mjs']) {
    assert.equal(mask(preserved, relative).text, preserved, relative);
  }
  assert.equal(mask(preserved, 'harness/tests/fixtures/sample.jsonl').text, preserved.replace(uuid, '<id>'));
  assert.equal(mask('cupcake-bench-workspaces .claude-bench', 'harness/runner.mjs').text, 'cupcake-bench-workspaces .claude-bench');
});

test('allowlist exports exact public surfaces and excludes private and generated neighbors', async (t) => {
  const f = await fixture(t);
  const publicFiles = ['harness/runner.mjs', 'harness/AGGREGATION.md', 'harness/tests/unit.test.mjs', 'harness/tests/fixtures/stream.jsonl',
    'harness/tasks/T2.mjs', 'harness/fixtures/T2/base-src/src/index.js', 'harness/fixtures/T2/hidden-tests/test.mjs',
    'scripts/export-public.mjs', 'PUBLISHING.md', `${mainRun}/metrics.json`, `${mainRun}/report-tables.md`, `${mainRun}/report-summary.md`,
    `${mainRun}/quota-rate-table-2026.json`, `${mainRun}/tasks-main.json`, `${mainRun}/ids-all.txt`, `${mainRun}/runs-lane-fast.json`,
    `${mainRun}/runs-lane-lunamax.json`, `${mainRun}/mechanical-lane.json`, `${mainRun}/runs-lane-fast.json.artifacts-one/raw.jsonl`,
    `${mainRun}/runs-lane-fast.json.artifacts-one/change.diff`, `rounds/${round}/public/methodology.md`];
  const privateFiles = ['README.md', '.claude/settings.json', '.se' + 'rena/config.json', '_board/post.json', 'harness/fixtures/T2/base/secret.js',
    'harness/fixtures/T2/notes.md', 'harness/.git/config', 'harness/driver.log', 'harness/file.mjs.bak', 'harness/00-seat-test.md',
    `rounds/${round}/design/08-report.md`, `rounds/${round}/evidence/00-seat-test.md`, `rounds/${round}/evidence/opus-lane/runs-fast.json`,
    `${mainRun}/runs-pre-split.json`, `${mainRun}/runs-main-merged.json`, `${mainRun}/mechanical-incident-suspect/mechanical-a.json`,
    `${mainRun}/driver.log`, `${mainRun}/metrics.json.bak`, `${mainRun}/runs-lane-fast.json.artifacts-one/driver.log`,
    `${mainRun}/runs-lane-fast.json.artifacts-one/private.bak`, `${mainRun}/runs-lane-fast.json.artifacts-one/00-seat-test.md`,
    `rounds/other/public/README.md`, 'scripts/private.mjs'];
  for (const name of [...publicFiles, ...privateFiles]) await f.put(name);
  const before = execFileSync('git', ['-C', f.sourceRoot, 'status', '--porcelain']).toString();
  await requireApi('exportPublic')(f);
  assert.deepEqual(await files(f.out), [...publicFiles, 'README.md', 'EXPORT-MANIFEST.json'].sort());
  assert.equal(execFileSync('git', ['-C', f.sourceRoot, 'status', '--porcelain']).toString(), before);
  assert.equal(await readFile(path.join(f.sourceRoot, privateFiles[0]), 'utf8'), 'public\n');
});

test('manifest records source identity, exact payload bytes, applied masks, and successful output lint', async (t) => {
  const f = await fixture(t);
  await f.put(`${mainRun}/metrics.json`, JSON.stringify({ cwd: `${host}/bench`, thread: uuid, model: 'gpt-6-astra' }));
  await f.put(`rounds/${round}/public/README.md`, '# Public results\n');
  await requireApi('exportPublic')(f);
  const manifest = JSON.parse(await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, execFileSync('git', ['-C', f.sourceRoot, 'rev-parse', 'HEAD']).toString().trim());
  assert.equal(manifest.round, round);
  assert.equal(manifest.fileCount, 3);
  assert.equal(manifest.files.length, manifest.fileCount);
  let bytes = 0;
  for (const entry of manifest.files) {
    const data = await readFile(path.join(f.out, entry.path));
    assert.equal(entry.bytes, data.length);
    bytes += data.length;
  }
  assert.equal(manifest.bytes, bytes);
  assert.equal(manifest.masking.home, 1);
  assert.equal(manifest.masking.uuid, 1);
  assert.deepEqual(manifest.lint, { hits: 0, passed: true });
  assert.equal(await readFile(path.join(f.out, 'README.md'), 'utf8'), '# Public results\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(f.out, mainRun, 'metrics.json'), 'utf8')), { cwd: '/home/<user>/bench', thread: '<id>', model: 'gpt-6-astra' });
});

test('artifact filenames remain distinct and references resolve without leaking original identifiers', async (t) => {
  const f = await fixture(t);
  const artifact = `${mainRun}/runs-lane-fast.json.artifacts-one`;
  await f.put(`${artifact}/${uuid}.jsonl`, JSON.stringify({ thread: uuid, answer: 'first' }));
  await f.put(`${artifact}/${v4}.jsonl`, JSON.stringify({ thread: v4, answer: 'second' }));
  await f.put(`${mainRun}/runs-lane-fast.json`, JSON.stringify([{ rawStreamPath: path.join(f.sourceRoot, artifact, `${uuid}.jsonl`) }, { rawStreamPath: path.join(f.sourceRoot, artifact, `${v4}.jsonl`) }]));
  await requireApi('exportPublic')(f);
  const outputFiles = await files(f.out);
  assert.equal(outputFiles.filter((name) => name.endsWith('.jsonl')).length, 2);
  for (const name of outputFiles) assert.ok(!name.includes(uuid) && !name.includes(v4));
  const records = JSON.parse(await readFile(path.join(f.out, mainRun, 'runs-lane-fast.json'), 'utf8'));
  assert.notEqual(records[0].rawStreamPath, records[1].rawStreamPath);
  for (const [index, record] of records.entries()) {
    const relative = record.rawStreamPath;
    assert.equal(path.isAbsolute(relative), false);
    assert.ok(relative.startsWith(mainRun + "/"));
    assert.equal(JSON.parse(await readFile(path.join(f.out, relative), 'utf8')).answer, index === 0 ? 'first' : 'second');
  }
  assert.equal((await requireApi('lintDirectory')(f.out)).length, 0);
});

test('standalone lint exits nonzero and reports every hit with file and line; fixture UUID exemption is narrow', async (t) => {
  const f = await fixture(t);
  await mkdir(f.out);
  await writeFile(path.join(f.out, 'planted.md'), `clean\n${host} ${'net' + 'cup'}\n${uuid}\n`);
  const result = spawnSync(process.execPath, [script, `--lint-only=${f.out}`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /planted\.md:2:/);
  assert.match(result.stdout, /planted\.md:3:/);
  assert.match(result.stdout, /3 hits/);
  const lint = requireApi('lintDirectory');
  await mkdir(path.join(f.out, 'harness/tasks'), { recursive: true });
  await mkdir(path.join(f.out, 'harness/tests/fixtures'), { recursive: true });
  await writeFile(path.join(f.out, 'harness/tasks/sample.mjs'), uuid);
  await writeFile(path.join(f.out, 'harness/tests/fixtures/sample.jsonl'), uuid);
  const hits = await lint(f.out);
  assert.equal(hits.length, 4);
  assert.ok(hits.some((hit) => hit.file === 'harness/tests/fixtures/sample.jsonl'));
  assert.ok(!hits.some((hit) => hit.file === 'harness/tasks/sample.mjs'));
});

test('lint does not silently narrow required identity, tool, or credential patterns', async (t) => {
  const f = await fixture(t);
  await mkdir(f.out);
  const banned = [host, 'ru' + 'yari', 'ek' + 'duddldi', 'net' + 'cup', 'mi' + 'sel', 'Mi' + 'sel', '@' + 'cupcake', 'se' + 'rena', 'code-review-' + 'graph',
    'astra-' + 'implementer', 'luna-' + 'coder', 'terra-' + 'coder', 'sol-' + 'reviewer', 'luna-' + 'scout', 'codex-' + 'delegate', 'advisory-' + 'panel',
    'Ol' + 'lama', '21e4' + '6669', 'sk-' + 'abcdefghijklmnopqrst', 'OPENAI_' + 'API_KEY', 'ANTHROPIC_' + 'API', 'shell_' + 'snapshots', '/tmp/cupcake' + '-t', uuid];
  await writeFile(path.join(f.out, 'tokens.txt'), banned.join('\n'));
  const hits = await requireApi('lintDirectory')(f.out);
  assert.deepEqual(hits.map((hit) => hit.line), banned.map((_, i) => i + 1));
  // The external provider's name is an owner-approved public literal (2026-09-09) and the shipped
  // supplement names it in its own tables, so it is pinned as ALLOWED rather than merely absent:
  // dropping it from both lists would re-narrow the guard without anyone noticing.
  assert.ok(api.ALLOWED_LITERALS.includes('Nano' + 'GPT'));
  await writeFile(path.join(f.out, 'tokens.txt'),
    '.claude-bench cupcake-bench-workspaces CODEX_HOME gpt-6-astra ' + 'Nano' + 'GPT');
  assert.deepEqual(await api.lintDirectory(f.out), []);
});

test('a round publishes only what it declares, and absence is not permission', async (t) => {
  const f = await fixture(t);
  const contract = path.join(f.sourceRoot, 'rounds', f.round, 'export.json');
  const exportPublic = requireApi('exportPublic');
  await f.put('harness/main.mjs');
  await f.put(`rounds/${f.round}/public/methodology.md`);

  await rm(contract);
  await assert.rejects(exportPublic(f), /no rounds\/.*export\.json|declares/i);
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });

  await writeFile(contract, JSON.stringify({ formatVersion: 1, publish: false, include: ['public/**'] }));
  await assert.rejects(exportPublic(f), /not marked for publication/i);

  await writeFile(contract, JSON.stringify({ formatVersion: 99, publish: true, include: ['public/**'] }));
  await assert.rejects(exportPublic(f), /formatVersion/i);

  // A contract may only describe its own round; escaping upward is refused, not silently ignored.
  await writeFile(contract, JSON.stringify({ formatVersion: 1, publish: true, include: ['../../harness/**'] }));
  await assert.rejects(exportPublic(f), /unsafe include glob/i);

  await writeFile(contract, JSON.stringify({ formatVersion: 1, publish: true, include: ['public/**'] }));
  const manifest = await exportPublic(f);
  assert.deepEqual(manifest.roundContract.include, ['public/**']);
  assert.ok(manifest.files.some((entry) => entry.path === `rounds/${f.round}/public/methodology.md`));
});

test('fixture task content is opt-in: an unlisted fixture directory never exports', async (t) => {
  const f = await fixture(t);
  await f.put('harness/fixtures/example/base-src/keep.txt', 'public\n');
  await f.put('harness/fixtures/example/hidden-tests/oracle.mjs', '// public\n');
  await f.put('harness/fixtures/unlisted/base-src/secret.txt', 'private bank\n');
  await f.put('harness/fixtures/unlisted/hidden-tests/oracle.mjs', '// private\n');
  const manifest = await requireApi('exportPublic')(f);
  const paths = manifest.files.map((entry) => entry.path);
  assert.ok(paths.includes('harness/fixtures/example/base-src/keep.txt'));
  assert.ok(paths.includes('harness/fixtures/example/hidden-tests/oracle.mjs'));
  assert.ok(!paths.some((name) => name.startsWith('harness/fixtures/unlisted/')));
  assert.deepEqual(await files(path.join(f.out, 'harness/fixtures')), [
    'example/base-src/keep.txt', 'example/hidden-tests/oracle.mjs']);
});

test('a round pinned to a harness commit refuses to export from a harness that moved', async (t) => {
  const f = await fixture(t);
  const contract = path.join(f.sourceRoot, 'rounds', f.round, 'export.json');
  const head = execFileSync('git', ['-C', f.sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(contract, JSON.stringify({ formatVersion: 1, publish: true, include: ['public/**'], harnessCommit: head }));
  await f.put(`rounds/${f.round}/public/methodology.md`);
  // The pinned commit is the empty fixture commit, so any harness file is drift.
  await f.put('harness/added-after-the-round.mjs');
  await assert.rejects(requireApi('exportPublic')(f), /harness\/ differs from/i);
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
});

test('failed export lint is recorded and cannot masquerade as successful export', async (t) => {
  const f = await fixture(t);
  await f.put('harness/example.mjs', '// net' + 'cup\n');
  await assert.rejects(requireApi('exportPublic')(f), /lint/i);
  const manifest = JSON.parse(await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8'));
  assert.deepEqual(manifest.lint, { hits: 1, passed: false });
});

test('dry run computes masks and lint without creating the destination', async (t) => {
  const f = await fixture(t);
  await f.put(`${mainRun}/metrics.json`, JSON.stringify({ path: host }));
  const manifest = await requireApi('exportPublic')({ ...f, dry: true });
  assert.equal(manifest.fileCount, 2);
  assert.equal(manifest.masking.home, 1);
  assert.equal(manifest.lint.hits, 0);
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
});

test('force removes only manifest-owned files, keeps git and foreign files, and is idempotent', async (t) => {
  const f = await fixture(t);
  await f.put('harness/old.mjs', 'old');
  const exportPublic = requireApi('exportPublic');
  await exportPublic(f);
  const first = await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8');
  await assert.rejects(exportPublic(f), /non-empty/i);
  assert.equal(await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8'), first);
  await mkdir(path.join(f.out, '.git'));
  await writeFile(path.join(f.out, '.git/config'), 'private git metadata');
  await writeFile(path.join(f.out, 'owner.txt'), 'keep me');
  await rm(path.join(f.sourceRoot, 'harness/old.mjs'));
  await f.put('harness/new.mjs', 'new');
  await exportPublic({ ...f, force: true });
  await assert.rejects(readFile(path.join(f.out, 'harness/old.mjs')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.out, 'harness/new.mjs'), 'utf8'), 'new');
  assert.equal(await readFile(path.join(f.out, '.git/config'), 'utf8'), 'private git metadata');
  assert.equal(await readFile(path.join(f.out, 'owner.txt'), 'utf8'), 'keep me');
  const second = await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8');
  await exportPublic({ ...f, force: true });
  assert.equal(await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8'), second);
});

test('force cannot claim a foreign output, escape via forged manifest, or overwrite an unowned destination', async (t) => {
  const f = await fixture(t);
  const exportPublic = requireApi('exportPublic');
  await mkdir(f.out);
  await writeFile(path.join(f.out, 'keep.txt'), 'keep');
  await assert.rejects(exportPublic({ ...f, force: true }), /manifest/i);
  await writeFile(path.join(f.root, 'outside.txt'), 'outside');
  await writeFile(path.join(f.out, 'EXPORT-MANIFEST.json'), JSON.stringify({ formatVersion: 1, files: [{ path: '../outside.txt', bytes: 7 }] }));
  await assert.rejects(exportPublic({ ...f, force: true }), /manifest|unsafe/i);
  assert.equal(await readFile(path.join(f.root, 'outside.txt'), 'utf8'), 'outside');
  await rm(f.out, { recursive: true });
  await exportPublic(f);
  await mkdir(path.join(f.out, 'harness'));
  await writeFile(path.join(f.out, 'harness/new.mjs'), 'owned by user');
  await f.put('harness/new.mjs', 'generated');
  await assert.rejects(exportPublic({ ...f, force: true }), /unowned/i);
  assert.equal(await readFile(path.join(f.out, 'harness/new.mjs'), 'utf8'), 'owned by user');
});

test('source/output overlap, symlinks, and binary payloads fail closed before output writes', async (t) => {
  const f = await fixture(t);
  const exportPublic = requireApi('exportPublic');
  await f.put('harness/main.mjs');
  await assert.rejects(exportPublic({ ...f, out: path.join(f.sourceRoot, 'public') }), /overlap|source/i);
  await writeFile(path.join(f.root, 'secret.mjs'), 'private');
  await symlink(path.join(f.root, 'secret.mjs'), path.join(f.sourceRoot, 'harness/link.mjs'));
  await assert.rejects(exportPublic(f), /symlink/i);
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
  await rm(path.join(f.sourceRoot, 'harness/link.mjs'));
  await f.put('harness/image.bin', Buffer.from([0, 255, 1]));
  await assert.rejects(exportPublic(f), /binary/i);
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
});

test('binary task inputs round-trip verbatim only under fixture base-src and remain linted', async (t) => {
  const f = await fixture(t);
  // Same length-prefix/NUL shape as the existing event-stream task samples.
  const data = Buffer.from([0, 0, 0, 3, 1, 255, 65]);
  const relative = 'harness/fixtures/example/base-src/data/input.evt';
  await f.put(relative, data);
  await requireApi('exportPublic')(f);
  assert.deepEqual(await readFile(path.join(f.out, relative)), data);
  const manifest = JSON.parse(await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8'));
  assert.equal(manifest.binaryFileCount, 1);
  assert.deepEqual(manifest.binaryFiles, [relative]);
  assert.deepEqual(await api.lintDirectory(f.out), []);
  await writeFile(path.join(f.out, relative), Buffer.concat([data, Buffer.from(host)]));
  assert.ok((await api.lintDirectory(f.out)).some((hit) => hit.file === relative && hit.token === host));
  await f.put('harness/fixtures/example/hidden-tests/input.evt', data);
  await assert.rejects(api.exportPublic({ ...f, force: true }), /binary.*hidden-tests/);
  assert.deepEqual(await readFile(path.join(f.out, relative)), Buffer.concat([data, Buffer.from(host)]));
});

test('dry force includes retained foreign files in its lint without rewriting the output', async (t) => {
  const f = await fixture(t);
  const exportPublic = requireApi('exportPublic');
  await exportPublic(f);
  const before = await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8');
  await writeFile(path.join(f.out, 'owner.txt'), host);
  await assert.rejects(exportPublic({ ...f, force: true, dry: true }), /lint/i);
  assert.equal(await readFile(path.join(f.out, 'EXPORT-MANIFEST.json'), 'utf8'), before);
  assert.equal(await readFile(path.join(f.out, 'owner.txt'), 'utf8'), host);
});

test('CLI exports from its repository, supports dry and rejects unknown arguments without mutation', async (t) => {
  const f = await fixture(t);
  requireApi('exportPublic');
  await f.put('scripts/export-public.mjs', await readFile(script));
  await f.put('harness/main.mjs', 'export const value = 1;\n');
  const localScript = path.join(f.sourceRoot, 'scripts/export-public.mjs');
  const dry = spawnSync(process.execPath, [localScript, `--out=${f.out}`, `--round=${round}`, '--dry'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  await assert.rejects(readdir(f.out), { code: 'ENOENT' });
  const real = spawnSync(process.execPath, [localScript, `--out=${f.out}`, `--round=${round}`], { encoding: 'utf8' });
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /0 hits/);
  assert.match(await readFile(path.join(f.out, 'README.md'), 'utf8'), /operational details and intermediate artifacts are private by policy; everything needed to reproduce the published tables is here/);
  assert.equal(await readFile(path.join(f.out, 'harness/main.mjs'), 'utf8'), 'export const value = 1;\n');
  const unknown = spawnSync(process.execPath, [localScript, `--out=${f.out}`, '--typo'], { encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown/i);
});


test("repository-owned record paths become export-root-relative without changing external paths", async (t) => {
  const f = await fixture(t);
  const artifact = mainRun + "/runs-lane-fast.json.artifacts-relative";
  const raw = artifact + "/" + uuid + ".jsonl";
  const diff = raw + ".diff";
  await f.put(raw, JSON.stringify({ answer: "sample" }));
  await f.put(diff, "sample diff");
  const original = {
    rawStreamPath: path.join(f.sourceRoot, raw),
    gitDiffPath: path.join(f.sourceRoot, diff),
    rolloutPath: path.join(f.sourceRoot, raw),
    nested: { fixture: path.join(f.sourceRoot, "harness/fixtures/example/base-src/data.json"), repo: f.sourceRoot },
    sibling: f.sourceRoot + "-neighbor/other.txt",
    external: "/var/tmp/other-provider/rollout.jsonl",
  };
  await f.put(mainRun + "/runs-lane-fast.json", JSON.stringify([original]));
  const manifest = await requireApi("exportPublic")(f);
  const [record] = JSON.parse(await readFile(path.join(f.out, mainRun, "runs-lane-fast.json"), "utf8"));
  for (const key of ["rawStreamPath", "gitDiffPath", "rolloutPath"]) {
    assert.equal(path.isAbsolute(record[key]), false, key);
    assert.ok(record[key].startsWith(artifact + "/artifact-"), key);
    assert.ok(!record[key].includes("\\"), key);
    const data = await readFile(path.resolve(f.out, record[key]), "utf8");
    assert.equal(data, key === "gitDiffPath" ? "sample diff" : JSON.stringify({ answer: "sample" }));
  }
  assert.equal(record.nested.fixture, "harness/fixtures/example/base-src/data.json");
  assert.equal(record.nested.repo, ".");
  assert.equal(record.sibling, original.sibling);
  assert.equal(record.external, original.external);
  assert.equal(manifest.masking["repository-path"], 5);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.sourceRoot, mainRun, "runs-lane-fast.json"), "utf8")), [original]);
});

// A task module carries its prompt, its grader AND its reference bank, and that bank holds
// golden solutions. Publishing one hands over the answer key, so it is task content in exactly
// the sense the fixture gate already protects. The gate covered only harness/fixtures/ while
// the comment above it claimed to cover task content generally; Round 5 found the gap by
// exporting six task modules with the leak lint reporting zero hits.
test('a task module publishes only when its id is named, like a fixture', async () => {
  const { isAllowed, readPublicTasks, readPublicFixtures } = await import(script);
  const fixtures = new Set(['D1']);
  const tasks = new Set(['D1']);

  assert.equal(isAllowed('harness/tasks/D1.mjs', undefined, [], fixtures, tasks), true,
    'a named task must still publish');
  assert.equal(isAllowed('harness/tasks/Q1.mjs', undefined, [], fixtures, tasks), false,
    'an unnamed task must not publish');
  // Gating on the fixture list instead would silently drop every answer-mode task, which has
  // no fixture directory at all. The two lists are deliberately separate.
  assert.equal(isAllowed('harness/tasks/A1.mjs', undefined, [], fixtures, new Set(['A1'])), true,
    'an answer-mode task with no fixture must publish when named');

  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const named = await readPublicTasks(repoRoot);
  const namedFixtures = await readPublicFixtures(repoRoot);
  for (const id of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) {
    assert.ok(!named.has(id), `Round 5 task ${id} must stay unnamed: it carries its own goldens`);
    assert.ok(!namedFixtures.has(id), `Round 5 fixture ${id} must stay unnamed`);
  }
  assert.ok(named.has('D1'), 'the existing published payload must not shrink');
});
