import { read } from './io.mjs';
import { apply } from './patches.mjs';
const BYTES_PER_KIB = 1024;
export function load(run) {
  const factory = read('config/factory.json');
  const settings = structuredClone(factory);
  apply(settings, read(`config/profiles/${run.profile}.json`), factory);
  apply(settings, read(run.local), factory);
  const capacity = run.env.FRAME_CACHE_KIB;
  if (capacity !== undefined && capacity !== 'inherit') {
    if (!/^\d+$/.test(capacity)) throw new Error('Invalid capacity');
    settings.cache.maxBytes = Number(capacity) * BYTES_PER_KIB;
  }
  for (const token of run.argv) {
    const option = /^--cache-kind=(ram|disk)$/.exec(token);
    if (!option) throw new Error('Invalid cache option');
    settings.cache.kind = option[1];
  }
  return settings;
}
