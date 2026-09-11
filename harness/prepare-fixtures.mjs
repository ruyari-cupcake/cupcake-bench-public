#!/usr/bin/env node
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const GIT_TIMEOUT_MS = 30_000;
const IDENTITY = 'Ledger Maintainer';
const EMAIL = 'maintainer@example.invalid';
const COMMIT_DATE = '2026-01-01T00:00:00Z';
const execute = promisify(execFile);
// Ambient git identity, hooks, signing, index paths and templates must not leak
// host-specific state into the candidate repository or its reproducible commit.
const gitEnv = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: IDENTITY, GIT_AUTHOR_EMAIL: EMAIL, GIT_AUTHOR_DATE: COMMIT_DATE,
  GIT_COMMITTER_NAME: IDENTITY, GIT_COMMITTER_EMAIL: EMAIL, GIT_COMMITTER_DATE: COMMIT_DATE,
};

async function git(cwd, ...args) {
  const { stdout } = await execute('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args],
    { env: gitEnv, timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

// `--only=D2,D3b` limits regeneration to the named fixture ids. Without it every
// family's generated base is deleted and rebuilt, which races with any other
// process that is validating or running a sibling family at the same moment
// (observed 2026-09-07 with several authoring seats working concurrently).
function selectedIds(argv) {
  const option = argv.find((argument) => argument.startsWith('--only='));
  if (!option) return null;
  const ids = new Set(option.slice('--only='.length).split(',').map((id) => id.trim()).filter(Boolean));
  if (!ids.size) throw new Error('--only requires fixture ids');
  return ids;
}

async function main() {
  const only = selectedIds(process.argv.slice(2));
  const names = (await readdir(FIXTURES, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const id of only ?? []) {
    if (!names.some((entry) => entry.name === id && entry.isDirectory())) throw new Error(`selected fixture not found: ${id}`);
  }
  for (const fixture of names) {
    if (!fixture.isDirectory()) continue;
    if (only && !only.has(fixture.name)) continue;
    const directory = path.join(FIXTURES, fixture.name);
    const entries = await readdir(directory, { withFileTypes: true });
    if (!entries.some((entry) => entry.name === 'base-src' && entry.isDirectory())) continue;
    const base = path.join(directory, 'base');
    await rm(base, { recursive: true, force: true });
    await mkdir(base);
    await cp(path.join(directory, 'base-src'), base, { recursive: true });
    await git(base, '-c', 'init.templateDir=', 'init', '--initial-branch=main');
    await git(base, 'add', '--all');
    await git(base, 'commit', '-m', 'Initial import');
    if (await git(base, 'status', '--porcelain', '--untracked-files=all')) throw new Error(`Fixture is not clean: ${base}`);
    console.log(`${base} ${await git(base, 'rev-parse', 'HEAD')}`);
  }
}

main().catch((error) => {
  console.error('[prepare-fixtures]', String(error?.message ?? error));
  process.exitCode = 1;
});
