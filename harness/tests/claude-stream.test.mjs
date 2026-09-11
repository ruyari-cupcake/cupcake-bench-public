import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCodexStream, classifyOutcome } from '../lib/codex-stream.mjs';
import { auditToolPaths } from '../lib/path-audit.mjs';

// Before the adapter exists, challenge the current parser with the new provider's
// real protocol. RED is behavioral, not a missing-module exception.
const { parseClaudeStream = parseCodexStream } = await import('../lib/claude-stream.mjs')
  .catch((error) => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const fixture = async (name) => readFile(new URL(`fixtures/claude-${name}-stream.jsonl`, import.meta.url), 'utf8');
const jsonl = (events) => events.map(JSON.stringify).join('\n');
const assistant = (content, usage) => ({ type: 'assistant', message: { content, ...(usage ? { usage } : {}) } });
const text = (value) => ({ type: 'text', text: value });
const tool = (name, input, id = name) => ({ type: 'tool_use', name, input, id });
const result = (overrides = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: 'authoritative', num_turns: 1, ...overrides });
const outcome = (parsed) => classifyOutcome({ mode: 'answer', exitCode: 0, ...parsed });

test('frozen Claude answer stream preserves result, provider usage, cost and account utilization', async () => {
  const raw = await fixture('answer');
  const parsed = parseClaudeStream(raw);
  const final = JSON.parse(raw.trim().split('\n').at(-1));
  assert.equal(parsed.answer, 'ok');
  assert.equal(parsed.agentMessageCount, 1);
  assert.equal(parsed.modelOutputObserved, true);
  assert.equal(parsed.threadId, final.session_id);
  assert.deepEqual(parsed.usage, { input_tokens: 22247, cached_input_tokens: 0, output_tokens: 4, reasoning_output_tokens: 0 });
  assert.deepEqual(parsed.providerUsage, final.usage);
  assert.equal(parsed.costUsd, 0.22256);
  assert.deepEqual(parsed.anthropicUtilization, { fiveHour: 0.09, sevenDay: 0.59 });
  assert.equal(parsed.completedTurnCount, 1);
  assert.equal(parsed.toolCallCount, 0);
  assert.equal(outcome(parsed), 'ok');
  assert.deepEqual(Object.keys(parsed).sort(), [...Object.keys(parseCodexStream('')), 'providerUsage', 'costUsd', 'anthropicUtilization'].sort());
});

test('frozen Claude agentic stream counts actions separately and never sums cumulative result usage', async () => {
  const raw = await fixture('agentic');
  const parsed = parseClaudeStream(raw);
  const events = raw.trim().split('\n').map(JSON.parse);
  assert.equal(parsed.answer, '`add` used `a - b`; changed to `a + b`. Output: `5`.');
  assert.deepEqual(parsed.toolCalls.map((call) => call.type), ['read_file', 'file_change', 'command_execution']);
  assert.deepEqual(parsed.toolCallsByType, { read_file: 1, file_change: 1, command_execution: 1 });
  assert.equal(parsed.completedTurnCount, 4);
  for (const field of ['turnCount', 'stepCount', 'toolCallCount']) assert.equal(parsed[field], 3);
  assert.deepEqual(parsed.usage, { input_tokens: 8 + 19975 + 58983, cached_input_tokens: 58983, output_tokens: 329, reasoning_output_tokens: 0 });
  assert.deepEqual(parsed.providerUsage, events.at(-1).usage);
  assert.deepEqual(parsed.usageSnapshots, events.filter((event) => event.type === 'assistant').map((event) => event.message.usage));
  assert.equal(parsed.usageSemantics, 'cumulative');
  assert.ok(Math.abs(parsed.costUsd - 0.2375065) < 1e-10);
  assert.deepEqual(parsed.anthropicUtilization, { fiveHour: 0.1, sevenDay: 0.59 });
  const audit = await auditToolPaths(parsed.toolCalls, '/tmp/opus-smoke/b');
  assert.ok(audit.pathsAccessed.includes('/tmp/opus-smoke/b/math.mjs'));
  assert.deepEqual(audit.fileChangeEvents.map(({ path, kind }) => ({ path, kind })), [{ path: '/tmp/opus-smoke/b/math.mjs', kind: 'update' }]);
});

test('all Claude tool variants retain their original inputs and audit-compatible paths', async () => {
  const calls = [tool('Write', { file_path: 'new.js', content: 'hi' }), tool('MultiEdit', { file_path: 'multi.js', edits: [] }),
    tool('NotebookEdit', { notebook_path: 'book.ipynb', new_source: 'hi' }), tool('Glob', { pattern: '*.mjs' }),
    tool('Grep', { pattern: 'hi', path: 'src' }), tool('LS', { path: 'lib' }), tool('WebSearch', { query: 'hi' }),
    tool('WebFetch', { url: 'https://example.invalid' }), tool('Custom', { file_path: 'other.js' })];
  const parsed = parseClaudeStream(jsonl([assistant(calls)]));
  assert.equal(parsed.modelOutputObserved, true);
  assert.equal(parsed.agentMessageCount, 0);
  assert.equal(parsed.toolCallCount, calls.length);
  assert.deepEqual(parsed.toolCalls.map(({ claudeTool }) => claudeTool), calls.map(({ name, input }) => ({ name, input })));
  assert.deepEqual(parsed.toolCalls.slice(0, 3).map(({ changes }) => changes), [
    [{ path: 'new.js', kind: 'add' }], [{ path: 'multi.js', kind: 'update' }], [{ path: 'book.ipynb', kind: 'update' }],
  ]);
  assert.deepEqual(parsed.toolCalls.slice(3, 6).map(({ type, path }) => ({ type, path })), [
    { type: 'list_directory', path: '.' }, { type: 'list_directory', path: 'src' }, { type: 'list_directory', path: 'lib' },
  ]);
  assert.equal(parsed.webEvents, 2);
  assert.deepEqual(parsed.toolCalls.at(-1), { type: 'tool_call', name: 'Custom', arguments: { file_path: 'other.js' }, id: 'Custom', claudeTool: { name: 'Custom', input: { file_path: 'other.js' } } });
  const audit = await auditToolPaths(parsed.toolCalls, '/tmp/claude-adapter');
  assert.deepEqual(audit.fileChangeEvents.map(({ path }) => path), ['/tmp/claude-adapter/new.js', '/tmp/claude-adapter/multi.js', '/tmp/claude-adapter/book.ipynb']);
  assert.ok(audit.pathsAccessed.includes('/tmp/claude-adapter'));
});

test('result is authoritative, errors retain last text block, and text messages count once', () => {
  const prefix = [assistant([text('first'), text('last')])];
  assert.equal(parseClaudeStream(jsonl([...prefix, result()])).answer, 'authoritative');
  const failed = parseClaudeStream(jsonl([...prefix, result({ subtype: 'error_max_turns', is_error: true, result: 'turn limit reached' })]));
  assert.equal(failed.answer, 'last');
  assert.equal(failed.agentMessageCount, 1);
  assert.deepEqual(failed.streamErrors, ['turn limit reached', 'error_max_turns']);
  assert.equal(outcome(failed), 'model_failure');
  const subtype = parseClaudeStream(jsonl([result({ subtype: 'error_during_execution' })]));
  assert.deepEqual(subtype.streamErrors, ['error_during_execution']);
  assert.equal(outcome(subtype), 'model_failure');
});

test('last utilization wins including missing windows; absent totals stay unknown', () => {
  const meter = (unifiedWindows) => ({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows } });
  const parsed = parseClaudeStream(jsonl([assistant([text('partial')], { input_tokens: 99 }),
    meter({ five_hour: { utilization: 0.9 }, seven_day: { utilization: 0.8 } }), meter({ five_hour: { utilization: 0 } })]));
  assert.deepEqual(parsed.anthropicUtilization, { fiveHour: 0, sevenDay: null });
  assert.equal(parsed.usage, null);
  assert.equal(parsed.providerUsage, null);
  assert.equal(parsed.costUsd, null);
  assert.equal(parsed.answer, 'partial');
  assert.equal(parseClaudeStream('').anthropicUtilization, null);
});

test('reasoning is an output subset and result-only streams are model output', () => {
  const parsed = parseClaudeStream(jsonl([result({ usage: { input_tokens: 3, cache_creation_input_tokens: 4, cache_read_input_tokens: 5, output_tokens: 100, output_tokens_details: { thinking_tokens: 60 } }, total_cost_usd: 0 })]));
  assert.equal(parsed.modelOutputObserved, true);
  assert.deepEqual(parsed.usage, { input_tokens: 12, cached_input_tokens: 5, output_tokens: 100, reasoning_output_tokens: 60 });
  assert.equal(parsed.costUsd, 0);
});

test('malformed envelopes count without losing valid text and terminal error signals', () => {
  const parsed = parseClaudeStream('not json\nnull\n[]\n7\n{"type":7}\n' + jsonl([assistant([text('partial')]), result({ is_error: true, result: 'failure' })]));
  assert.equal(parsed.malformedLines, 5);
  assert.equal(parsed.answer, 'partial');
  assert.deepEqual(parsed.streamErrors, ['failure']);
  assert.equal(outcome(parsed), 'model_failure');
});

for (const failure of ['rate_limit', 'overloaded', 'HTTP 529']) {
  test(`Claude ${failure} without model output is harness_invalid; partial output is model_failure`, () => {
    const error = { type: 'error', error: { message: failure } };
    const before = parseClaudeStream(jsonl([error]));
    assert.equal(before.modelOutputObserved, false);
    assert.equal(outcome(before), 'harness_invalid');
    const after = parseClaudeStream(jsonl([assistant([text('partial')]), error]));
    assert.equal(outcome(after), 'model_failure');
  });
}
