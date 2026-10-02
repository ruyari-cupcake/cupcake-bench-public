#!/usr/bin/env node
// Anthropic five-hour window admission gate for Claude lanes on the probe host (Sonnet 5.5 program, 2026-09-29).
//
// Owner rule carried from the Opus 5.5 program: at 80% of the five-hour window admit nothing new, let in-flight
// cells finish, continue after the reset. Two venue facts shape how that is enforced here:
//  - runner `--concurrency-file` and Desklet `CONCURRENCY` both ignore values below 1, so a lane can be pinned to
//    one admission but never to zero;
//  - the shared `/var/lib/bench-claude/PAUSE` flag also refuses Desklet `continue` turns, so setting it while a
//    session is between its A and B turns throws the finished A turn away (harness_invalid, rerun on --resume).
// So the gate is two-stage: SOFT at 80% pins every listed control file to 1 (no burst admission, in-flight work
// continues), HARD at 90% sets PAUSE (never-started cells exit 75 and are rerun with --resume). After the reported
// reset time both are undone and the previous control values restored. Utilization comes from the newest
// `rate_limit_event` in the live Claude stream artifacts the grading-host runners write; it is the account-wide value
// and stays in private evidence only.
import { readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { probeSshArgs } from '../venue.mjs';

const run = promisify(execFile);
export const SOFT_AT = 0.80;
export const HARD_AT = 0.90;
const PINNED = '1\n';
const POLL_MS = 60_000;
const FRESH_MS = 10 * 60_000;
const RESET_GRACE_S = 60;
const PAUSE = '/var/lib/bench-claude/PAUSE';
// Operator venue configuration (../venue.mjs), resolved when the gate first acts on the host.
const SSH = () => probeSshArgs(['-o', 'BatchMode=yes']);

/** Pure decision: which stage the gate should hold for the latest reading. */
export function decide({ utilization, resetsAt, nowS, stage }) {
  if (stage !== 'open' && resetsAt != null && nowS >= resetsAt + RESET_GRACE_S) return 'open';
  if (utilization == null) return stage;
  if (utilization >= HARD_AT) return 'hard';
  if (utilization >= SOFT_AT) return stage === 'hard' ? 'hard' : 'soft';
  return stage;
}

/** The last rate_limit_event line in a stream file, or null. */
export function lastWindow(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"rate_limit_event"')) continue;
    try {
      const five = JSON.parse(lines[i]).rate_limit_info?.unifiedWindows?.five_hour;
      if (five && typeof five.utilization === 'number') return { utilization: five.utilization, resetsAt: five.resetsAt ?? null };
    } catch { /* partial line while streaming */ }
  }
  return null;
}

// Runner lanes keep streams in `<runs>.json.artifacts-*/`, Desklet sessions under `<label>/r<n>/`; both are
// reached by a bounded walk of each root.
const MAX_DEPTH = 4;

async function newestReading(roots, nowMs) {
  let best = null;
  const walk = async (dir, depth) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < MAX_DEPTH) await walk(path, depth + 1); continue; }
      if (!entry.name.endsWith('.jsonl')) continue;
      const info = await stat(path).catch(() => null);
      if (!info || nowMs - info.mtimeMs > FRESH_MS || (best && info.mtimeMs <= best.mtimeMs)) continue;
      const reading = lastWindow(await readFile(path, 'utf8').catch(() => ''));
      if (reading) best = { ...reading, mtimeMs: info.mtimeMs, path };
    }
  };
  for (const root of roots) await walk(root, 0);
  return best;
}

async function main([statePath, ...args]) {
  const roots = []; const controls = [];
  for (const arg of args) (arg.startsWith('--control=') ? controls : roots).push(arg.replace(/^--control=/, ''));
  const log = async (entry) => appendFile(`${statePath}.log`, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  let state = { stage: 'open', saved: {}, resetsAt: null };
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch { /* first start */ }
  for (;;) {
    const reading = await newestReading(roots, Date.now());
    if (reading?.resetsAt) state.resetsAt = reading.resetsAt;
    const next = decide({ utilization: reading?.utilization ?? null, resetsAt: state.resetsAt, nowS: Date.now() / 1000, stage: state.stage });
    if (next !== state.stage) {
      if (state.stage === 'open') {
        for (const file of controls) state.saved[file] = await readFile(file, 'utf8').catch(() => null);
        for (const file of controls) await writeFile(file, PINNED);
      }
      if (next === 'hard') await run('ssh', [...SSH(), `sudo touch ${PAUSE}`]);
      if (next === 'open') {
        await run('ssh', [...SSH(), `sudo rm -f ${PAUSE}`]);
        for (const [file, value] of Object.entries(state.saved)) {
          if (value === null) await run('rm', ['-f', file]); else await writeFile(file, value);
        }
        state.saved = {};
      }
      await log({ from: state.stage, to: next, utilization: reading?.utilization ?? null, resetsAt: state.resetsAt });
      state.stage = next;
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error); process.exit(1); });
}
