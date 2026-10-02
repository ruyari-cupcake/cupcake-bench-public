// Evidence must be committed as files. A captured workspace or snapshot that still contains its own `.git` is recorded
// by `git add` as a mode-160000 gitlink, so none of its bytes enter this repository — silently (recurring-omissions
// ledger class 42: 9 Desklet snapshot dirs and 125 Morrow Opus-main workspaces, both 2026-09-28). Rename the nested
// `.git` to `git-metadata` before adding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const GITLINK_MODE = '160000';

export function gitlinks(lsFilesStage) {
  return lsFilesStage.split('\n').filter(line => line.startsWith(`${GITLINK_MODE} `)).map(line => line.split('\t')[1]);
}

test('the detector finds a gitlink entry and ignores regular files', () => {
  const sample = '100644 1111111111111111111111111111111111111111 0\tREADME.md\n'
    + '160000 2222222222222222222222222222222222222222 0\trounds/x/evidence/cell/A\n';
  assert.deepEqual(gitlinks(sample), ['rounds/x/evidence/cell/A']);
});

test('the repository index holds no gitlinks (nested .git committed as a submodule pointer)', () => {
  const found = gitlinks(execFileSync('git', ['-C', REPO, 'ls-files', '-s'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
  assert.deepEqual(found, [], `rename the nested .git to git-metadata and re-add: ${found.slice(0, 5).join(', ')}`);
});
