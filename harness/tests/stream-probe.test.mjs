import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCodexStream } from '../lib/codex-stream.mjs';

test('live P0-B stream is four action steps, one cumulative usage, not one agentic step', async () => {
  // Frozen copy of a real `codex exec --json` agentic run (2026-09-07). Kept INSIDE the
  // harness on purpose: the round directory it was captured in moves between rounds, and a
  // round-agnostic parser test must not break when it does. Provenance of the original:
  // rounds/round3-2026-09-07/evidence/p0b/agentic-event-shape.jsonl
  const raw = await readFile(new URL('./fixtures/agentic-event-shape.jsonl', import.meta.url), 'utf8');
  const parsed = parseCodexStream(raw);
  assert.equal(parsed.turnCount, 4);
  assert.equal(parsed.completedTurnCount, 1);
  assert.deepEqual(parsed.toolCallsByType, { command_execution: 3, file_change: 1 });
  assert.equal(parsed.usage.input_tokens, 56848);
  assert.equal(parsed.usage.output_tokens, 1068);
  assert.equal(parsed.answer, 'DONE');
  assert.equal(parsed.malformedLines, 0, 'CLI stdin banner is not malformed JSON');
});
