export const PROVIDERS = Object.freeze({
  deepseek: { baseUrl: 'https://api.deepseek.com', envKey: 'DEEPSEEK_API_KEY', models: ['deepseek-v4.1-flash-expires-on-0910', 'deepseek-v4-flash', 'deepseek-v4-pro'], efforts: ['none', 'low', 'high', 'max'] },
  nanogpt: { baseUrl: 'https://api.nano-gpt.com/api/v1', envKey: 'NANOGPT_API_KEY', models: ['z-ai/glm-5.3', 'z-ai/glm-5.3:thinking'], efforts: [] },
});

/** Configuration is evidence, so it must never carry runtime credentials. */
export function validateProviderConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Provider configuration required');
  const allowed = new Set(['provider', 'model', 'effort', 'baseUrl']);
  if (Object.keys(config).some(key => !allowed.has(key))) throw Error('Unexpected provider configuration field');
  const provider = Object.hasOwn(PROVIDERS, config.provider) && PROVIDERS[config.provider];
  if (!provider || !provider.models.includes(config.model)) throw Error('Unknown provider/model');
  if (typeof config.baseUrl !== 'string' || config.baseUrl !== provider.baseUrl) throw Error('Official provider base URL required');
  if (config.provider === 'deepseek' ? !provider.efforts.includes(config.effort) : config.effort !== undefined) throw Error('Unverified reasoning effort');
  return { ...config };
}

/** Inclusive counts: cached input and reasoning output are subsets, never additions. */
export function extractProviderUsage(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const values = [usage.input_tokens, usage.input_tokens_details?.cached_tokens, usage.output_tokens, usage.output_tokens_details?.reasoning_tokens, usage.total_tokens];
  for (const value of values) if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) throw Error('Invalid token count');
  if (values.some(value => value === undefined || value === null)) return null;
  const [inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens] = values;
  if (cachedInputTokens > inputTokens || reasoningOutputTokens > outputTokens || totalTokens !== inputTokens + outputTokens) throw Error('Contradictory inclusive token accounting');
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens };
}

/** Transport/availability failures select admission scope; they are not model scores. */
export function classifyProviderFailure({ status, body }) {
  const description = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  const outcome = (category, stopScope) => ({ category, stopScope });
  if (status === 401 || status === 403) return outcome('authentication', 'provider');
  if (status === 402 || /daily_(?:rpd|usd)_limit_exceeded|subscriptionQuotaAvailable["\s]*:\s*false|(?:subscription|daily|weekly)[\s_-]+(?:daily[\s_-]+|weekly[\s_-]+)?(?:quota|budget)\b.*(?:exhausted|exceeded)|insufficient balance/i.test(description)) return outcome('quota', 'provider');
  if (status === 429) return outcome('rate-limit', 'admission');
  if (status === 404) return outcome('unavailable', 'model');
  if (status >= 500 || status === null || status === undefined) return outcome('transient', 'none');
  if (status === 400) return outcome('unsupported-setting', 'config');
  return outcome('unclassified', 'config');
}
