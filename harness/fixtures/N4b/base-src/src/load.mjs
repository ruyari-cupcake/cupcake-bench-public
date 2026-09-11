import { read } from './io.mjs';
import { cli, environment } from './options.mjs';
export function load(run) {
  const layers = [read('config/defaults.json'), read(`config/profiles/${run.profile}.json`),
    read(run.local), cli(run.argv), environment(run.env)];
  return layers.reduce((state, layer) => ({ ...state, ...layer,
    retry: { ...state.retry, ...layer.retry } }), {});
}
