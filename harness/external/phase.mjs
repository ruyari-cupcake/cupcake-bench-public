import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runWorkflowPhase } from '../../../cupcake-bench-logbook/tools/workflow-runtime.mjs';
import { externalCodexOptions } from './provider-runtime.mjs';
import { classifyProviderFailure, validateProviderConfig } from './provider-contract.mjs';

/** Read only session identity fields; never emit prompts or the user's auth/config files. */
export async function readWorkerIdentity({ threadId, startedAt }) {
  if (typeof threadId !== 'string' || !/^[a-f0-9-]{36}$/.test(threadId)) throw Error('Invalid worker thread ID');
  const start = new Date(startedAt ?? Date.now());
  const dates = [...new Set([start.toISOString().slice(0, 10), new Date(start.getTime() + 9 * 3600000).toISOString().slice(0, 10)])];
  let filename;
  for (const day of dates) {
    const directory = path.join(process.env.HOME, '.codex/sessions', ...day.split('-'));
    let entries; try { entries = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const name = entries.find(name => name.endsWith(threadId + '.jsonl'));
    if (name) { filename = path.join(directory, name); break; }
  }
  if (!filename) throw Error('Worker identity record unavailable');
  const input = createReadStream(filename), lines = createInterface({ input, crlfDelay: Infinity });
  let provider, model, effort;
  try {
    for await (const line of lines) {
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'session_meta') provider = row.payload.model_provider;
      if (row.type === 'turn_context') { model = row.payload.model; effort = row.payload.effort; }
      // Resume may append a new context after the original one; consume identity rows
      // through EOF and keep the current phase's final context, without logging content.
    }
  } finally { lines.close(); input.destroy(); }
  return { provider, model, effort: effort ?? null, rolloutPath: filename };
}

function failureFromText(text) {
  if (/not supported when using Codex with a ChatGPT account/.test(text)) return { category: 'identity-mismatch', stopScope: 'provider' };
  const match = text.match(/(?:unexpected status|HTTP(?: status)?|["']status["']\s*:)\s*([45]\d\d)\b/i);
  if (match) return classifyProviderFailure({ status: Number(match[1]), body: text });
  if (/stream disconnected|error sending request|connection (?:reset|refused)|Selected model is at capacity/i.test(text)) return { category: 'transient', stopScope: 'none' };
  return null;
}

/** Keep the native reviewer intact and attach actual provider provenance to candidates. */
export function createExternalPhase({ providers, catalogPath, credentials, transportBaseUrls = {}, runPhase = runWorkflowPhase, spawnChild = spawn, verifyIdentity = readWorkerIdentity }) {
  const catalogSha256 = createHash('sha256').update(readFileSync(catalogPath)).digest('hex');
  for (const config of Object.values(providers)) validateProviderConfig(config);
  for (const [provider, value] of Object.entries(transportBaseUrls)) {
    const url = new URL(value);
    if (provider !== 'nanogpt' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Only an undecorated NanoGPT loopback transport is supported');
  }
  return async options => {
    if (!Object.hasOwn(providers, options.config)) return runPhase(options);
    const config = providers[options.config];
    let providerMetadata = null;
    const adapter = externalCodexOptions(config, { secret: credentials[config.provider], catalogPath,
      baseSpawn(command, argv, spawnOptions) {
        let effective = [...argv];
        if (transportBaseUrls[config.provider]) effective = effective.map(value => value.startsWith('model_providers.' + config.provider + '.base_url=') ? 'model_providers.' + config.provider + '.base_url=' + JSON.stringify(transportBaseUrls[config.provider]) : value);
        if (config.effort === undefined) {
          effective = effective.filter((value, index, all) => !(value === '-c' && all[index + 1]?.startsWith('model_reasoning_effort=')) && !value.startsWith('model_reasoning_effort='));
        }
        if (options.readOnly && !existsSync(path.join(options.workspace, '.git'))) effective.splice(1, 0, '--skip-git-repo-check');
        providerMetadata = { provider: config.provider, model: config.model, effort: config.effort ?? null, catalogSha256, argv: effective };
        // This exclusive write must succeed before the first paid process can start.
        writeFileSync(path.join(options.cellDir, options.name + '-provider.json'), JSON.stringify(providerMetadata, null, 2) + '\n', { flag: 'wx' });
        return spawnChild(command, effective, spawnOptions);
      },
    });
    const result = await runPhase({ ...options, ...adapter });
    let rawCodexUsage = null, stderr = '';
    try {
      for (const line of (await readFile(path.join(options.cellDir, options.name + '.jsonl'), 'utf8')).split('\n')) {
        try { const event = JSON.parse(line); if (event.type === 'turn.completed') rawCodexUsage = event.usage ?? null; } catch {}
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { stderr = await readFile(path.join(options.cellDir, options.name + '-stderr.txt'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let providerFailure = failureFromText((result.errors ?? []).join('\n') + '\n' + stderr), observedIdentity = null;
    if (result.completed) {
      try {
        observedIdentity = await verifyIdentity({ threadId: result.threadId, model: config.model, provider: config.provider, startedAt: result.startedAt });
        if (observedIdentity.provider !== config.provider || observedIdentity.model !== config.model || (config.effort !== undefined && observedIdentity.effort != null && observedIdentity.effort !== config.effort)) providerFailure = { category: 'identity-mismatch', stopScope: 'provider' };
      } catch (error) { providerFailure = { category: 'identity-unverified', stopScope: 'provider', message: error.message }; }
    }
    const metadata = { providerMetadata, observedIdentity, providerFailure, rawCodexUsage };
    await writeFile(path.join(options.cellDir, options.name + '-provider-result.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    return { ...result, ...metadata, ...(providerFailure?.category.startsWith('identity-') ? { completed: false } : {}) };
  };
}
