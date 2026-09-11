import { read } from './io.mjs';
import { merge, count } from './merge.mjs';
export function load(run) {
  const settings = read('config/defaults.json');
  const profile = read(`config/profiles/${run.profile}.json`);
  if (profile.extends) merge(settings, read(`config/profiles/${profile.extends}.json`));
  merge(settings, profile.settings);
  if (run.local) merge(settings, read(run.local));
  if (run.env.PREVIEW_WORKERS?.trim()) settings.preview.workers = count(run.env.PREVIEW_WORKERS);
  for (const arg of run.argv) {
    if (!arg.startsWith('--workers=')) throw new Error('Unknown argument');
    const value = arg.slice('--workers='.length);
    if (value !== 'auto') settings.preview.workers = count(value);
  }
  return settings;
}
