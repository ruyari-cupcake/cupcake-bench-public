import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenNamespaceRequest, restoreNamespaceResponse } from '../external/nanogpt-wire.mjs';

/* Independent RED map. Inline fixtures preserve the actual request/tool-call shapes of
 * compatibility/nanogpt-wire-probes/{default-namespace,default-flat}.json, 2026-09-09;
 * values are synthetic and tests do not require those retained run files or any API call.
 * - Flattening: mixed native/namespace tools + repeated names across namespaces; exact
 *   schemas/order/mapping catch tool loss, ambiguous identity and destructive renaming.
 * - Continuation: full request history contains function calls/results/text/reasoning;
 *   exact unchanged IDs/argument bytes and reverse-transform equality catch broken call linkage.
 * - Response envelopes: item, completed response output and direct output; exact event/usage
 *   equality except known names catches changing SSE framing or dropping accounting.
 * - Rejection/ownership: delimiter collisions and unsupported nested tools fail atomically;
 *   mutate returned nested objects to verify caller-owned history/events remain detached.
 * Existing runtime tests inspect spawn arguments, not the provider's function wire protocol.
 * Gaps: streaming transport framing, HTTPS proxy lifecycle, exact provider function-name limits,
 * named tool_choice translation and live tool execution remain root integration boundaries.
 */

const fn = (name = 'exec') => ({ type: 'function', name, description: 'Synthetic marker tool',
  parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false }, strict: true });
const ns = (name = 'mcp__workspace', tools = [fn()]) => ({ type: 'namespace', name, description: 'Synthetic tools', tools });
const request = (overrides = {}) => ({ model: 'z-ai/glm-5.3', input: 'Call exec with WIRE_OK.',
  tools: [ns()], tool_choice: 'required', max_output_tokens: 1024, store: false, stream: true,
  reasoning: { effort: null, summary: null }, metadata: { label: 'synthetic' }, ...overrides });
const mapping = { mcp__workspace__exec: { namespace: 'mcp__workspace', name: 'exec' } };
const call = (overrides = {}) => ({ type: 'function_call', id: 'fc_synthetic', call_id: 'call_synthetic',
  name: 'mcp__workspace__exec', arguments: '{"command":"WIRE_OK","text":"exec mcp__workspace"}', status: 'completed', ...overrides });

test('namespace tool becomes one flat function while every other request field and schema is preserved', () => {
  const original = request();
  const before = structuredClone(original);
  const flattened = flattenNamespaceRequest(original);
  assert.deepEqual(flattened.body, { ...before, tools: [{ ...before.tools[0].tools[0], name: 'mcp__workspace__exec' }] });
  assert.deepEqual(flattened.mapping, mapping);
  assert.deepEqual(original, before);
  flattened.body.tools[0].parameters.properties.command.type = 'number';
  flattened.body.metadata.label = 'modified result';
  assert.deepEqual(original, before, 'nested output is detached from caller configuration');
});

test('mixed tools retain order and same function names in different namespaces stay distinct', () => {
  const tools = [fn('plain'), ns('alpha', [fn('exec'), fn('read')]), ns('beta', [fn('exec')])];
  const flattened = flattenNamespaceRequest(request({ tools }));
  assert.deepEqual(flattened.body.tools, [fn('plain'), { ...fn('exec'), name: 'alpha__exec' },
    { ...fn('read'), name: 'alpha__read' }, { ...fn('exec'), name: 'beta__exec' }]);
  assert.deepEqual(flattened.mapping, {
    alpha__exec: { namespace: 'alpha', name: 'exec' }, alpha__read: { namespace: 'alpha', name: 'read' },
    beta__exec: { namespace: 'beta', name: 'exec' },
  });
});

test('full continuation history preserves arguments and call linkage while namespaced calls are flattened', () => {
  const namedCall = call({ name: 'exec', namespace: 'mcp__workspace' });
  const input = [
    { role: 'user', content: [{ type: 'input_text', text: 'mcp__workspace exec stays literal here' }] },
    { type: 'reasoning', id: 'reasoning_1', summary: [], encrypted_content: 'synthetic-opaque' },
    namedCall,
    { type: 'function_call_output', call_id: namedCall.call_id, output: '{"name":"exec","namespace":"mcp__workspace"}' },
    call({ id: 'plain_fc', call_id: 'plain_call', name: 'plain' }),
  ];
  const original = request({ input, previous_response_id: 'response_before' });
  const before = structuredClone(original);
  const transformed = flattenNamespaceRequest(original);
  const expectedCall = { ...namedCall, name: 'mcp__workspace__exec' }; delete expectedCall.namespace;
  assert.deepEqual(transformed.body.input, [input[0], input[1], expectedCall, input[3], input[4]]);
  assert.equal(transformed.body.previous_response_id, 'response_before');
  assert.deepEqual(restoreNamespaceResponse({ output: [transformed.body.input[2]] }, transformed.mapping).output, [namedCall]);
  assert.deepEqual(original, before);
  transformed.body.input[0].content[0].text = 'changed detached content';
  assert.deepEqual(original, before);
});

test('ordinary flat requests and string input remain unchanged with an empty mapping', () => {
  for (const original of [request({ tools: [fn('plain')] }), request({ tools: [] }), { model: 'z-ai/glm-5.3', input: 'plain text' }]) {
    const before = structuredClone(original);
    const transformed = flattenNamespaceRequest(original);
    assert.deepEqual(transformed.body, before);
    assert.deepEqual(transformed.mapping, {});
    assert.notEqual(transformed.body, original);
    assert.deepEqual(original, before);
  }
});

test('encoded name collisions fail atomically rather than overwriting the map or dropping a tool', () => {
  for (const tools of [
    [fn('alpha__exec'), ns('alpha', [fn('exec')])],
    [ns('alpha', [fn('exec')]), fn('alpha__exec')],
    [ns('alpha__beta', [fn('exec')]), ns('alpha', [fn('beta__exec')])],
    [ns('alpha', [fn('exec'), fn('exec')])],
  ]) {
    const original = request({ tools }); const before = structuredClone(original);
    assert.throws(() => flattenNamespaceRequest(original));
    assert.deepEqual(original, before);
  }
});

test('unsupported nested tool kinds throw before any partial request mutation', () => {
  for (const nested of [{ type: 'custom', name: 'custom' }, ns('nested'), { type: 'web_search' }]) {
    const original = request({ tools: [ns('first', [fn('valid'), nested])] });
    const before = structuredClone(original);
    assert.throws(() => flattenNamespaceRequest(original));
    assert.deepEqual(original, before);
  }
});

test('SSE output-item events restore only function identity and preserve type, ids and arguments', () => {
  for (const type of ['response.output_item.added', 'response.output_item.done']) {
    const original = { type, sequence_number: 7, output_index: 2, item: call(), extra: { retained: true } };
    const before = structuredClone(original);
    const restored = restoreNamespaceResponse(original, mapping);
    assert.deepEqual(restored, { ...before, item: { ...before.item, name: 'exec', namespace: 'mcp__workspace' } });
    assert.deepEqual(original, before);
    restored.extra.retained = false;
    assert.deepEqual(original, before);
  }
});

test('completed and direct responses restore output calls without touching usage or unrelated items', () => {
  const output = [{ type: 'message', id: 'msg_synthetic', content: [{ type: 'output_text', text: 'exec' }] }, call(), call({ name: 'unknown__exec' })];
  const response = { id: 'resp_synthetic', model: 'z-ai/glm-5.3:thinking', status: 'completed', output,
    usage: { input_tokens: 192, output_tokens: 13, total_tokens: 205, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, cost: 0 } };
  for (const nested of [false, true]) {
    const original = nested ? { type: 'response.completed', sequence_number: 19, response } : response;
    const before = structuredClone(original);
    const expected = structuredClone(original);
    const target = nested ? expected.response : expected;
    target.output[1] = { ...target.output[1], name: 'exec', namespace: 'mcp__workspace' };
    const restored = restoreNamespaceResponse(original, mapping);
    assert.deepEqual(restored, expected);
    assert.deepEqual(original, before);
    (nested ? restored.response : restored).usage.input_tokens_details.cached_tokens = 9;
    assert.deepEqual(original, before);
  }
});

test('argument deltas and unknown names remain intact and never acquire guessed namespaces', () => {
  for (const original of [
    { type: 'response.function_call_arguments.delta', item_id: 'fc_synthetic', output_index: 0, delta: '{"name":"mcp__workspace__exec"' },
    { type: 'response.function_call_arguments.done', item_id: 'fc_synthetic', arguments: '{"command":"WIRE_OK"}' },
    { item: call({ name: 'unknown__exec' }) }, { item: call({ name: 'exec' }) },
    { item: { type: 'message', name: 'mcp__workspace__exec', content: [] } },
  ]) {
    const before = structuredClone(original);
    const restored = restoreNamespaceResponse(original, mapping);
    assert.deepEqual(restored, before);
    assert.notEqual(restored, original);
    assert.deepEqual(original, before);
  }
});
