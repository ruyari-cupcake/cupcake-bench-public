import { validateProviderConfig } from './provider-contract.mjs';

/** One global admission budget; resizing never cancels valid in-flight model work. */
export async function runExternalSchedule(manifest, { runCell, sample, recordEvent, signal, now = Date.now, pollMs = 1000 }) {
  const { cells, providers, resourcePolicy: policy } = manifest;
  if (!Array.isArray(cells) || new Set(cells.map(cell => cell.id)).size !== cells.length || cells.some(cell => !Object.hasOwn(providers, cell.config))) throw Error('Invalid or duplicate schedule cells');
  for (const config of Object.values(providers)) validateProviderConfig(config);
  if (!Array.isArray(policy.stages) || !policy.stages.length || policy.stages.some((value, index, stages) => !Number.isInteger(value) || value < 1 || (index && value <= stages[index - 1])) || !Number.isFinite(policy.minimumStageSeconds) || policy.minimumStageSeconds < 0) throw Error('Invalid resource stages');
  if (!Number.isFinite(pollMs) || pollMs < 1) throw Error('Positive scheduling poll interval required');
  const results = [], skipped = [], stopped = [], active = new Set();
  const cooldownMs = policy.rateLimitCooldownMs ?? 0;
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) throw Error('Invalid rate-limit cooldown');
  let cursor = 0, stage = 0, stageStarted = now(), fatal = null, admissionAfter = 0;
  const emit = async event => {
    try { await recordEvent({ at: new Date(now()).toISOString(), ...event }); }
    catch (error) { fatal ??= error; throw error; }
  };
  const resize = async (next, reason) => {
    if (stage === next) return;
    stage = next; stageStarted = now();
    await emit({ type: 'concurrency', concurrency: policy.stages[stage], reason, active: active.size });
  };
  const stoppedBy = cell => {
    const provider = providers[cell.config];
    return stopped.find(stop => stop.stopScope === 'provider' ? stop.provider === provider.provider : stop.stopScope === 'model' ? stop.provider === provider.provider && stop.model === provider.model : stop.config === cell.config);
  };
  if (signal?.aborted) throw Error('Schedule aborted before admission');
  await emit({ type: 'concurrency', concurrency: policy.stages[0], reason: 'initial', active: 0 });
  while (active.size || (!fatal && cursor < cells.length)) {
    try {
      if (signal?.aborted) throw Error('Schedule aborted; active results will be retained');
      if (!fatal) {
        const resources = await sample();
        if (![resources.cpuPercent, resources.availableMiB, resources.swapOutDelta].every(Number.isFinite)) throw Error('Resource telemetry unavailable');
        await emit({ type: 'resource', ...resources, concurrency: policy.stages[stage], active: active.size });
        const pressure = resources.cpuPercent > policy.lowerAboveCpuPercent || resources.availableMiB < policy.lowerBelowAvailableMiB || (policy.lowerOnSwapOut && resources.swapOutDelta > 0);
        if (pressure && stage > 0) await resize(stage - 1, 'resource-pressure');
        else if (!pressure && stage < policy.stages.length - 1 && now() - stageStarted >= policy.minimumStageSeconds * 1000 && resources.cpuPercent < policy.raiseBelowCpuPercent && resources.availableMiB > policy.raiseAboveAvailableMiB) await resize(stage + 1, 'observed-headroom');
      }
    } catch (error) { fatal ??= error; }
    while (!fatal && now() >= admissionAfter && active.size < policy.stages[stage] && cursor < cells.length) {
      const cell = cells[cursor++];
      const skip = stop => skipped.push({ id: cell.id, config: cell.config, reason: stop.category, stopScope: stop.stopScope });
      const stop = stoppedBy(cell);
      if (stop) { skip(stop); continue; }
      try { await emit({ type: 'start', id: cell.id, config: cell.config, concurrency: policy.stages[stage] }); }
      catch { break; }
      if (fatal || signal?.aborted) { fatal ??= Error('Schedule aborted before next admission'); break; }
      const changedStop = stoppedBy(cell);
      if (changedStop) { skip(changedStop); continue; }
      const job = Promise.resolve().then(() => runCell(cell, { signal })).then(async result => {
        results.push(result);
        const boundary = result.providerFailure;
        if (boundary && ['provider', 'model', 'config'].includes(boundary.stopScope)) {
          const target = { ...boundary, provider: providers[cell.config].provider, model: providers[cell.config].model, config: cell.config, cellId: cell.id };
          stopped.push(target);
          await emit({ type: 'stop', ...target });
        } else if (boundary?.stopScope === 'admission') {
          admissionAfter = Math.max(admissionAfter, now() + cooldownMs);
          await resize(Math.max(0, stage - 1), 'provider-rate-limit');
          await emit({ type: 'cooldown', until: new Date(admissionAfter).toISOString(), milliseconds: cooldownMs });
        }
        await emit({ type: 'result', id: cell.id, config: cell.config, outcome: result.outcome, providerFailure: boundary ?? null });
      }).catch(error => { fatal ??= error; }).finally(() => active.delete(job));
      active.add(job);
    }
    if (active.size || (!fatal && cursor < cells.length)) {
      let timer;
      await Promise.race([...active, new Promise(resolve => { timer = setTimeout(resolve, pollMs); })]);
      clearTimeout(timer);
    }
  }
  if (fatal) throw fatal;
  return { results, skipped, stopped };
}
