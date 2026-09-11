# Publishing the benchmark

**Publish the method and results; protect active evaluation content.**
Never push private repository history to a public remote. Private-origin backup
pushes remain governed by the workspace's Git conventions.

## Policy for rounds after Round 3

Owner decision, 2026-09-09: publish several representative examples while retaining
private evaluation and reserve problems to reduce future exposure. Keep Round 3's
existing public release available. The rules below govern new rounds; the legacy
export specification later in this document describes Round 3 only.

### Disclosure matrix

| Material | Public examples and retired-public tasks | Active private evaluation and reserve tasks |
|---|---|---|
| Prompts, candidate fixtures/data, references, hidden tests and task-specific graders | Publish a complete reproducible bundle after exposure review | Private |
| Candidate answers, diffs, tool traces and detailed test feedback | Publish with personal/operational masking | Private: these can reconstruct the problem or solution |
| Reusable runner, generic scoring/aggregation code and public example tests | Public if their code, imports and test data reveal no protected content | Use the same content review; task banks and their generators are not generic code |
| Measurement purpose, capability descriptions, scoring principles and thresholds | Public | Public at a non-reconstructive level |
| Configuration, effort, environment, dates, limits, sample counts and cost basis | Public, masking private infrastructure/account identity | Same for evaluated tasks; reserve scheduling/details remain private |
| Scores, time, usage, uncertainty, failure/exclusion counts and correction impact | Public | Publish non-reconstructive numeric records and aggregates; mask/reduce identifying dimensions as needed |
| Internal authoring discussions, agent instructions, private provenance and operational logs | Private | Private |

Always disclose material measurement limitations and exclusion/retry methodology.
Private operations are not a reason to conceal an environment incident's effect on
scores or a grader correction. Explain that effect without copying raw private logs.
For reserve tasks that have not been scored, there are no evaluation results to publish.

### Select examples before scores

- Offer multiple examples spanning capabilities and difficulty levels. Freeze IDs
  and the selection rationale before candidate scores are inspected. The round plan
  records the chosen count/coverage; there is no universal percentage or quota.
- If selection unavoidably uses already-seen results, label it retrospective and
  disclose the selection basis rather than claiming prospective selection.
- Treat examples as reproducible demonstrations and optional public-task measurements.
  Report their scores separately from private evaluation; never pool the two.
- Separate the sets by **source incident and solution structure (lineage)**, not by
  random rows or renamed variables. Different variants of the same solution pattern
  cannot serve as both a public example and a claimed unexposed private holdout.
  Sharing a broad capability such as migration is allowed; inspect close derivatives.

### Exposure and retirement

Track a task revision's role (`public-example`, `private-evaluation`, `reserve`, or
`retired-public`) separately from its dated exposure history. Record creation,
freeze, development/model exposure, first evaluation, and first public exposure,
with lineage links across rounds. A local private file is not proof that no model
provider or earlier session has seen its contents; state what is actually known.

Private tasks may be retained across rounds or retired when they saturate, leak,
lose workload relevance, or are replaced. **There is no automatic release deadline
and no promise that every private task will eventually be public.**

Before a retired release, check related active/reserve tasks for transferable solution
leakage. Keep the retiring bundle private if publication would expose those tasks,
or replace/retire the affected lineage first. Record the decision and date. Release
the complete reproducible bundle when appropriate, preserving personal/operational
privacy. Once exposed, do not relabel a task as unexposed after deletion or renaming.
An accidental leak gets a dated exposure event and a disclosed evaluation impact;
results remain historical evidence but no longer support an unexposed-task claim.

Public history remains available for reproducibility and continuity. Improved
performance on it alone proves neither generalization nor memorization. New private
tasks must be added to support new-problem comparisons.

### Transparency while task content is private

Publish the frozen method, selection rationale at capability level, actual sample
denominators, comparison coverage, result metadata, uncertainty and limitations.
Where safe, publish numeric per-cell records under opaque IDs so aggregates can be
recomputed. Omit free text, answer-bearing component names, paths and exact task
details; explain any reduction in released granularity.

Preserve complete unmasked recovery/audit evidence privately. Freeze committed task,
grader, configuration and protocol artifacts before scoring and retain hashes/dates.
If publishing a pre-run commitment, use a bundle hash with a private random nonce
when low-entropy contents could be guessed; retain it for later audit/release. Hashes
help detect later changes, not prove correct grading or freedom from contamination.
Do not claim full third-party grading reproducibility while inputs/tests are private;
distinguish recomputing aggregates from rerunning tasks and checking their grades.

### Export contract — a round declares its own payload (2026-09-10)

This section previously read *"documentation is not enforcement"*: the exporter copied all of
`harness/**` including task content, `--round` selected evidence but never a harness snapshot,
and each round's layout was hard-coded in the script, so every new round meant editing it.
**Those three gaps are now closed in `scripts/export-public.mjs` and pinned by its tests.**

**Adding a round must never mean editing the exporter.** A round declares what it publishes;
the script only knows what every publication carries.

#### `rounds/<round>/export.json`

```json
{
  "formatVersion": 1,
  "publish": true,
  "note": "why this payload and not more",
  "harnessCommit": "<commit whose harness/ produced these numbers>",
  "include": ["public/**", "evidence/main-run/metrics.json"]
}
```

- `include` globs are **relative to the round directory**. A contract cannot describe another
  round or the repository at large; an escaping glob is refused, not ignored.
- **Absence is not permission.** A round with no contract, or with `publish: false`, does not
  export — the run fails before writing anything.
- `harnessCommit` is optional and pins reproducibility: if `harness/` has moved since that commit
  — modified, deleted, or newly added and untracked — the export refuses and names the commit.
  Re-export an old round from its own commit rather than publishing code that never ran.
- The contract itself is not exported; `EXPORT-MANIFEST.json` records its `include` list and
  `harnessCommit`, so a reader can see the declared scope without the file.

#### Task content is opt-in

`harness/fixtures/PUBLIC.json` carries two lists: `fixtures` names the fixture directories
eligible for export, and `tasks` names the task modules. **Anything nobody listed does not
publish.** A new bank, generator, seed or grading oracle under `harness/fixtures/`, and a new
module under `harness/tasks/`, are therefore private by default and cannot leak by being
forgotten. Listing one is a deliberate disclosure decision; taking one back is
`PUBLISHING.md` § Exposure and retirement.

**Why `tasks` is a separate list, and why it exists at all (2026-09-11).** A task module holds
its prompt, its grader AND its reference bank — and that bank contains golden solutions. It is
task content in exactly the sense the fixture list protects, but the gate matched only
`harness/fixtures/` and Round 5's first export carried six modules out with the leak lint
reporting zero hits. The list is separate from `fixtures` rather than shared because answer-mode
tasks have no fixture directory; gating them on the fixture list would silently withhold them
from an existing publication. An absent `tasks` list withholds every module, matching what a
missing `PUBLIC.json` already means for fixtures; a malformed one throws, because that is a
mistake rather than a decision.

#### Checklist for a new round's first export

1. Write `rounds/<round>/export.json`; start from `public/**` and add evidence only where a
   published table cannot be recomputed without it.
2. Set `harnessCommit` to the commit the round was measured at.
3. Add any newly public fixture ids to `harness/fixtures/PUBLIC.json` `fixtures`, and any newly
   public task ids to its `tasks`, and nothing else. A round that keeps its problems unseen adds
   neither — which is the normal case for a round whose fixtures will be reused.
4. `node scripts/export-public.mjs --dry --out=<tmp> --round=<round>` and read the file count,
   byte total and masking counts before writing anything real.
5. Confirm the payload against the disclosure matrix above: prompts, answers, diffs, logs and
   solution-bearing metadata must not appear. Personal masking remains required.
6. Only then export for real, and record the public commit in `rounds/index.json`.

#### Still out of band

Some published material was not produced by this exporter and is not governed by the contract:
Round 4's `examples/` and both supplements' `RELEASE-MANIFEST.json` come from the separate
logbook assembler. Supplements publish through their parent round and have no contract of their
own. Anything assembled outside this script must be recorded in the round's plan.

## Legacy Round 3 export specification

Round 4 now has a separate result assembler in the Logbook repository:
`../cupcake-bench-logbook/tools/export-round4.mjs`; its exact procedure and validation
live in `../cupcake-bench-logbook/docs/publication.md`. It adds an allowlisted new-round
subtree plus named navigation replacements, retaining the existing public Round 3
payload. The whole-harness exporter below remains historical tooling. Round-document
roles and the publication-completion checklist are owned by
[benchmark-guidelines.md](benchmark-guidelines.md#durable-round-navigation-and-release-documents).

The rest of this document describes the existing complete-disclosure exporter and
its historical reproduction contract, not a blanket allowlist for later rounds.

**Publish the measurement, hide the operation.**
The public repository is a generated, allowlisted copy, not another remote of this
private repository. Everything not explicitly allowed is private by default.

Decision rule: a file needed to **REPRODUCE or INTERPRET** a result is public; a file
that says **HOW WE WORKED or WHY WE FAILED** is private; if it contains both, keep
only the former in a human-written public account.

## 1. Public measurement and reproduction inputs

These are copied from the selected `rounds/<round>/` only:

- `harness/**`: reusable code, `AGGREGATION.md`, tests, `tests/fixtures/**`, tasks and
  historical regression inputs. Executable harness code is copied verbatim.
- `harness/tasks/**`: the frozen prompts and grading rules.
- Under `harness/fixtures/*/`, **only** `base-src/**` and `hidden-tests/**` are public.
  Generated `base/` repositories are not exported. Rebuild them with
  `node harness/prepare-fixtures.mjs` before running the benchmark.
- `rounds/<round>/evidence/main-run/{metrics.json,report-tables.md,report-summary.md,tasks-main.json}`.
- `rounds/<round>/evidence/main-run/quota-rate-table-*.json` and `ids-*.txt`.
- `rounds/<round>/evidence/main-run/runs-*-{fast,lunamax}.json` and `mechanical-*.json`.
- `rounds/<round>/evidence/main-run/runs-*.artifacts-*/**`: raw streams and text diffs.
- `rounds/<round>/public/**`: human-written methodology, results and limitations.
- `scripts/export-public.mjs` and this `PUBLISHING.md`: the publication mechanism
  and its policy are public too, so its accompanying tests remain runnable.

Raw measurements and recorded test streams receive the masks below. No score,
model name, task identifier, prompt, grading rule, or environment-variable name is
intentionally changed. Non-code fixture text receives the general path masks;
UUID-like task sample data is always preserved. Binary candidate inputs are allowed
**only** under `harness/fixtures/*/base-src/**` and copied byte-for-byte; their
decodable bytes are still linted. The manifest records their count and paths.
NUL-bearing or non-UTF-8 files anywhere else abort export with the path named.
This accommodates the existing event-stream fixture's binary framing without
changing measurement inputs or silently exempting arbitrary files from lint.

## 2. Masked or human-edited material

The script's `MASKING_RULES` describe the exact transformations and its manifest
records the number of replacements under each rule ID:

- `home`: the private account's absolute home prefix becomes `/home/<user>`.
- `workspace`: the whole per-cell directory under `<ws>
  becomes `<ws>`; a suffix such as `/src/x.js` stays intact.
- `snapshot`: complete shell snapshot paths (absolute or home-relative), and
  UUID/timestamp snapshot filenames, become `<id>`.
- `uuid`: any 8-4-4-4-12 hexadecimal identifier, including v4/v7 and recorded thread
  IDs, becomes `<id>` **only** in `rounds/**` and `harness/tests/fixtures/**`.
  Never apply this rule in `harness/tasks/**` or `harness/fixtures/**`.
- `artifact-name` / `artifact-reference`: raw artifact filename identifiers become
  deterministic `artifact-NNNNNN` labels, consistently in filenames, stream/diff
  path references and manifest entries. Mapping happens before generic UUID
  masking, preventing thousands of files from collapsing into one `<id>` name.
- `repository-path`: absolute paths owned by the source repository become
  export-root-relative POSIX paths before artifact and privacy masking. For example,
  recorded `rawStreamPath` and `gitDiffPath` resolve directly beneath the output
  directory as `rounds/.../artifact-NNNNNN.jsonl` and its paired diff. Nested
  repository paths follow the same rule; a reference to the repository root becomes
  `.`. External paths stay external (with the normal privacy masks), and references
  to private-only inputs do not imply those files were exported.

The identifiers `gpt-5.6-luna`, `gpt-6-astra`, `claude-opus-5`, task IDs and `CODEX_*`
environment-variable **names** remain intact. Private configuration or operational
comments in executable harness code are fixed in the source, not rewritten by
export. The Claude runner uses `CUPCAKE_BENCH_CLAUDE_CONFIG_DIR`, defaulting to
`path.join(os.homedir(), '.claude-bench')`; it does not use a host-specific literal.

Design documents are **not** auto-exported. Only a human rewrite placed under
`rounds/<round>/public/**` is eligible. Public limitations must describe material
measurement limits without copying operational incident logs or seat instructions.

### Fail-closed output lint

`BANNED_TOKENS` in the script is the single authoritative list: private host/account
identifiers, personal names, private tool/seat/skill names, credentials, snapshot
paths, private scratch prefixes, and UUIDs outside `harness/tasks/**` and
`harness/fixtures/**`. The script uses assembled literals so its own published
source and tests do not plant forbidden literal examples. Matching is case-sensitive
with both specified personal-name variants; the historical lowercase `nanogpt`
judgment-channel key is measurement schema and remains unchanged.

Two directory **names**, `.claude-bench` and `cupcake-bench-workspaces`, are deliberately
not banned: they are portable reproduction defaults, not host identities. Absolute
private home prefixes and individual workspace paths are still masked. The key
pattern is `(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20,}`: a boundary and realistic minimum
length avoid mistaking ordinary words such as `draft-desk-verification-` for keys.
These refinements keep source and benign evidence intact rather than redacting them.

Lint scans output filenames and contents, reports every hit as `file:line:token`,
and exits nonzero on any hit. A name-only hit uses line 1. Unknown text that still
matches a banned token is not silently removed or automatically approved. Stop and
correct the source or the publication scope before publishing. A failed export's
manifest records `passed: false`; it is not a publishable result.

## 3. Private, never exported

- `rounds/<round>/design/**` in full.
- `rounds/<round>/evidence/**` except the explicit main-run paths above: seat specs
  `00-seat-*.md`, `01-deferred-tiers.md`, smoke/authoring ledgers, `driver.log`,
  `runner-*.log`, `postprocess.log`, `grade-*.log`, `*.bak`,
  `mechanical-incident-suspect/`, `peek-classes-*.txt`, `opus-lane/**`, `p0a/**`,
  `p0b/**`, `slice/**`, and `authoring-smoke/**`.
- `.claude/**`, local code-indexer configuration/cache, `_board/**`, `.git/**`,
  `node_modules/**`, and generated `harness/fixtures/*/base/**`.
- `.log`, `.bak` and `00-seat-*.md` files even when nested under an otherwise
  allowed directory. Other rounds and unlisted root files are excluded.
- Anything containing a remaining banned token: the lint blocks publication.

## Commands and ownership

Run from the private repository with Node 24; no package dependencies are needed:

```bash
node scripts/export-public.mjs --out=<empty-directory> --round=round3-2026-09-07 --dry
node scripts/export-public.mjs --out=<empty-directory> --round=round3-2026-09-07
node scripts/export-public.mjs --lint-only=<export-directory>
node --test 'harness/tests/*.test.mjs'
```

`--dry` prepares and checks the proposed export without creating or writing output.
Without `--round`, the default is `round3-2026-09-07`. Without `--force`, an existing
non-empty output is refused. For a previous generated tree, `--force` uses the
existing manifest to delete **only previously generated files**, then regenerates
them; it never deletes directories, `.git`, or unowned files. A missing/invalid
manifest, unowned destination collision, symlink, or source/output overlap aborts
before writing. Do not edit generated files; edit public source docs and regenerate.
Do not run exports concurrently into the same destination.

`EXPORT-MANIFEST.json` contains the source HEAD commit, selected round, per-file
paths and byte lengths, total file count and bytes, masking counts, and lint result.
Counts/bytes include all payload files and the root README, **exclude the manifest
itself**, and use decimal MB (`bytes / 1,000,000`). Source HEAD identifies the base
commit; uncommitted source changes are included, so review/commit the source before
using its commit as the identity of a final published release.

The root public README copies `rounds/<round>/public/README.md` when present;
otherwise it is generated with this disclosure:

> operational details and intermediate artifacts are private by policy; everything needed to reproduce the published tables is here

The script never initializes git, commits, tags, or pushes either repository. Review
the generated tree and its zero-hit lint before separately initializing or pushing
**the public copy**. **Never push private history to a public remote.**

## Allowed literal

The public repository's own URL (`github.com/<account>/cupcake-bench-public`) contains the hosting
account name, which is public by virtue of hosting the repo. That exact literal is stripped from a
line before banned-token matching (`ALLOWED_LITERALS` in `scripts/export-public.mjs`); the bare
account name anywhere else still fails the lint.
