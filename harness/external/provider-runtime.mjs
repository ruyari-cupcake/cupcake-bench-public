import { spawn } from 'node:child_process';
import path from 'node:path';
import { PROVIDERS, validateProviderConfig } from './provider-contract.mjs';

/** Add a provider only to this worker launch; never change the owner's Codex config. */
export function externalCodexOptions(input, { secret, catalogPath, baseSpawn = spawn }) {
  const config = validateProviderConfig(input);
  if (typeof secret !== 'string' || !secret.trim() || secret.trim() !== secret) throw Error('Runtime credential required');
  if (typeof catalogPath !== 'string' || !path.isAbsolute(catalogPath)) throw Error('Absolute model catalog path required');
  const prefix = `model_providers.${config.provider}.`;
  const settings = {
    model_provider: config.provider, model_catalog_json: catalogPath,
    suppress_unstable_features_warning: true,
    [prefix + 'name']: config.provider, [prefix + 'base_url']: config.baseUrl,
    [prefix + 'wire_api']: 'responses', [prefix + 'env_key']: PROVIDERS[config.provider].envKey,
    [prefix + 'request_max_retries']: 0, [prefix + 'stream_max_retries']: 0,
  };
  const overrides = Object.entries(settings).flatMap(([key, value]) => ['-c', key + '=' + JSON.stringify(value)]);
  return {
    spawnChild(command, argv, options) {
      if (command !== 'codex') throw Error('Credential transport only supports Codex workers');
      if (argv[0] !== 'exec') throw Error('Expected an exec phase');
      // exec has its own config parser: root-level overrides are lost when exec also
      // receives -c options (observed with CLI 0.153.4). Keep all overrides in that parser.
      return baseSpawn(command, ['exec', ...overrides, ...argv.slice(1)], {
        ...options, env: { ...options.env, [PROVIDERS[config.provider].envKey]: secret },
      });
    },
  };
}
