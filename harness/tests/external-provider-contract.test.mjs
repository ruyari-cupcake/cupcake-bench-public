import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProviderConfig, extractProviderUsage, classifyProviderFailure,
} from '../external/provider-contract.mjs';

/* Independent contract tests; no provider calls, credentials, or implementation helpers.
 * Pre-RED attack map (all use the public functions in the local Node venue):
 * - Config identity: synthetic allowed/near-miss model, effort, URL and credential fields;
 *   kills fallback aliases, permissive URLs and inline secrets; oracle is retained identity or rejection.
 * - Accounting: shape from compatibility/preview-high.json (2026-09-09, synthetic READY canary);
 *   perturb cache/reasoning subsets, absent fields and invalid counts; oracle is exact inclusive
 *   totals, null for unknown, rejection for contradictory data. Existing Claude parser tests
 *   cover a different provider protocol and cannot establish this Responses contract.
 * - Failure scope: synthetic official-status and NanoGPT quota examples from the delegation;
 *   vary status/body representation; exact category/scope kills indiscriminate retry, model
 *   penalty for transport failures, and confusing temporary throughput with exhausted quota.
 * Gaps routed to root: actual effort support/expiry, request credentials/redirects, worker tools,
 * continuation, persistence, scheduling and score exclusion need worker/live boundary evidence.
 */

const deepseek = (overrides = {}) => ({
  provider: 'deepseek', model: 'deepseek-v4.1-flash-expires-on-0910',
  effort: 'high', baseUrl: 'https://api.deepseek.com', ...overrides,
});
const nanogpt = (overrides = {}) => ({
  provider: 'nanogpt', model: 'z-ai/glm-5.3', baseUrl: 'https://api.nano-gpt.com/api/v1',
  ...overrides,
});
const response = (usageOverrides = {}) => ({
  object: 'response', status: 'completed',
  usage: {
    input_tokens: 38, input_tokens_details: { cached_tokens: 0 },
    output_tokens: 20, output_tokens_details: { reasoning_tokens: 17 },
    total_tokens: 58, ...usageOverrides,
  },
});
const classification = (status, body) => {
  const { category, stopScope } = classifyProviderFailure({ status, body });
  return { category, stopScope };
};

test('retains exact DeepSeek model and requested effort across the authorized matrix', () => {
  for (const model of ['deepseek-v4.1-flash-expires-on-0910', 'deepseek-v4-flash', 'deepseek-v4-pro']) {
    for (const effort of ['none', 'low', 'high', 'max']) {
      const input = deepseek({ model, effort });
      const validated = validateProviderConfig(input);
      for (const key of ['provider', 'model', 'effort', 'baseUrl']) {
        assert.equal(validated[key], input[key], `${model}/${effort}: preserve ${key}`);
      }
    }
  }
});

test('NanoGPT accepts both exact GLM routes without inventing a required effort', () => {
  for (const model of ['z-ai/glm-5.3', 'z-ai/glm-5.3:thinking']) {
    const validated = validateProviderConfig(nanogpt({ model }));
    assert.equal(validated.provider, 'nanogpt');
    assert.equal(validated.model, model);
    assert.equal(validated.baseUrl, 'https://api.nano-gpt.com/api/v1');
    assert.equal(validated.effort, undefined);
  }
});

test('rejects unknown providers, aliases, provider/model mismatch and unsupported DeepSeek efforts', () => {
  const invalid = [
    deepseek({ provider: 'openai' }), deepseek({ provider: 'DeepSeek' }),
    deepseek({ model: 'deepseek-chat' }), deepseek({ model: 'preview' }),
    deepseek({ model: 'deepseek-v4.1-flash' }), deepseek({ model: 'z-ai/glm-5.3' }),
    nanogpt({ model: 'glm-5.3' }), nanogpt({ model: 'deepseek-v4-pro' }),
    deepseek({ effort: 'medium' }), deepseek({ effort: 'xhigh' }),
    deepseek({ effort: 'HIGH' }), deepseek({ effort: '' }),
  ];
  for (const config of invalid) assert.throws(() => validateProviderConfig(config));
});

test('rejects incomplete or malformed provider configurations', () => {
  for (const config of [null, [], 'deepseek', {}, deepseek({ model: null }), deepseek({ baseUrl: null })]) {
    assert.throws(() => validateProviderConfig(config));
  }
});

test('official origins cannot be replaced by other hosts, schemes, ports or API paths', () => {
  for (const baseUrl of [
    'http://api.deepseek.com', 'https://api.deepseek.com.example.org',
    'https://example.org/api.deepseek.com', 'https://api.deepseek.com:8443',
    'https://api.deepseek.com/v1', 'https://api.deepseek.com/responses',
    'https://api.nano-gpt.com/api/v1',
  ]) assert.throws(() => validateProviderConfig(deepseek({ baseUrl })), baseUrl);
  for (const baseUrl of [
    'https://api.nano-gpt.com', 'https://api.nano-gpt.com/api/v2',
    'https://api.nano-gpt.com/api/v1/responses', 'https://api.deepseek.com',
  ]) assert.throws(() => validateProviderConfig(nanogpt({ baseUrl })), baseUrl);
});

test('URL credentials, queries and fragments are refused on both otherwise allowed routes', () => {
  for (const input of [deepseek(), nanogpt()]) {
    for (const baseUrl of [
      input.baseUrl.replace('https://', 'https://user:synthetic-password@'),
      `${input.baseUrl}?api_key=synthetic-only`, `${input.baseUrl}#synthetic-only`,
    ]) assert.throws(() => validateProviderConfig({ ...input, baseUrl }));
  }
});

test('inline credentials cannot enter configuration through common names or nested headers', () => {
  for (const credential of [
    { apiKey: 'synthetic-only' }, { api_key: 'synthetic-only' },
    { authorization: 'Bearer synthetic-only' }, { Authorization: 'Bearer synthetic-only' },
    { token: 'synthetic-only' }, { accessToken: 'synthetic-only' },
    { headers: { Authorization: 'Bearer synthetic-only' } },
    { headers: { 'X-Api-Key': 'synthetic-only' } },
  ]) assert.throws(() => validateProviderConfig(deepseek(credential)));
});

test('extracts the observed Responses canary counts without adding reasoning output twice', () => {
  assert.deepEqual(extractProviderUsage(response()), {
    inputTokens: 38, cachedInputTokens: 0, outputTokens: 20,
    reasoningOutputTokens: 17, totalTokens: 58,
  });
});

test('cache and reasoning remain subsets even when they cover every billed token', () => {
  assert.deepEqual(extractProviderUsage(response({
    input_tokens: 91, input_tokens_details: { cached_tokens: 91 },
    output_tokens: 41, output_tokens_details: { reasoning_tokens: 41 }, total_tokens: 132,
  })), { inputTokens: 91, cachedInputTokens: 91, outputTokens: 41, reasoningOutputTokens: 41, totalTokens: 132 });
});

test('explicit zero usage is valid evidence and remains distinct from missing telemetry', () => {
  assert.deepEqual(extractProviderUsage(response({
    input_tokens: 0, input_tokens_details: { cached_tokens: 0 },
    output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0,
  })), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 });
});

test('missing terminal usage is unknown, including a completed answer with no accounting', () => {
  for (const input of [null, {}, { usage: null }, { object: 'response', status: 'completed', output: [] }]) {
    assert.equal(extractProviderUsage(input), null);
  }
});

test('partial accounting never manufactures zero cache/reasoning or derives missing totals', () => {
  for (const missing of ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details']) {
    const input = response();
    delete input.usage[missing];
    assert.equal(extractProviderUsage(input), null, missing);
  }
  for (const detail of ['input_tokens_details', 'output_tokens_details']) {
    assert.equal(extractProviderUsage(response({ [detail]: {} })), null, detail);
  }
});

test('negative, fractional, nonnumeric and nonfinite token counts cannot become valid measurements', () => {
  for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) {
    for (const value of [-1, 0.5, '20', NaN, Infinity]) {
      assert.throws(() => extractProviderUsage(response({ [field]: value })), `${field}: ${value}`);
    }
  }
  for (const [detail, field] of [['input_tokens_details', 'cached_tokens'], ['output_tokens_details', 'reasoning_tokens']]) {
    for (const value of [-1, 0.5, '0', NaN, Infinity]) {
      assert.throws(() => extractProviderUsage(response({ [detail]: { [field]: value } })));
    }
  }
});

test('accounting rejects subsets above their parent and contradictory inclusive totals', () => {
  for (const overrides of [
    { input_tokens_details: { cached_tokens: 39 } },
    { output_tokens_details: { reasoning_tokens: 21 } },
    { total_tokens: 57 }, { total_tokens: 59 },
  ]) assert.throws(() => extractProviderUsage(response(overrides)));
});

test('401/403 stop the provider for authentication even when body is empty or non-JSON', () => {
  for (const [status, body] of [[401, null], [401, { error: { message: 'Invalid API key' } }], [403, 'Forbidden']]) {
    assert.deepEqual(classification(status, body), { category: 'authentication', stopScope: 'provider' });
  }
});

test('402 insufficient balance stops the provider instead of retrying or penalizing a model', () => {
  assert.deepEqual(classification(402, { error: { message: 'Insufficient balance' } }), {
    category: 'quota', stopScope: 'provider',
  });
});

test('NanoGPT subscription quota signals stop the entire provider', () => {
  for (const body of [
    { error: { code: 'daily_rpd_limit_exceeded', message: 'Daily request allowance exhausted' } },
    { error: { code: 'daily_usd_limit_exceeded', message: 'Subscription daily budget exhausted' } },
    { subscriptionQuotaAvailable: false, error: { message: 'Subscription unavailable' } },
    { error: { message: 'Subscription quota exhausted; resets tomorrow' } },
    'Subscription daily quota exceeded',
    JSON.stringify({ error: { code: 'daily_usd_limit_exceeded' } }),
  ]) assert.deepEqual(classification(429, body), { category: 'quota', stopScope: 'provider' });
});

test('ordinary 429 throughput limits back off admissions while preserving provider availability', () => {
  for (const body of [
    { error: { code: 'rate_limit_exceeded', message: 'Too many requests per minute' } },
    { subscriptionQuotaAvailable: true, error: { message: 'Rate limit exceeded' } },
    'Too many requests', null,
  ]) assert.deepEqual(classification(429, body), { category: 'rate-limit', stopScope: 'admission' });
});

test('404 unavailable or expired model stops that model without disabling the provider', () => {
  for (const message of ['Model not found', 'This preview model has expired']) {
    assert.deepEqual(classification(404, { error: { message } }), { category: 'unavailable', stopScope: 'model' });
  }
});

test('server failures remain transient, including a non-JSON gateway response', () => {
  for (const [status, body] of [[500, { error: { message: 'Internal error' } }], [502, '<html>Bad gateway</html>'], [503, null]]) {
    assert.deepEqual(classification(status, body), { category: 'transient', stopScope: 'none' });
  }
});

test('unsupported effort stops only its configuration and cannot masquerade as capability failure', () => {
  assert.deepEqual(classification(400, { error: {
    code: 'unsupported_parameter', param: 'reasoning.effort', message: 'Unsupported reasoning effort',
  } }), { category: 'unsupported-setting', stopScope: 'config' });
});
