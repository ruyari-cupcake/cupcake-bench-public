import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function read(root, name) {
  return JSON.parse(await readFile(path.join(root, name), 'utf8'));
}

export async function apiSettings(root) {
  const view = await read(root, 'view.json');
  return view.routes;
}

export async function workerSettings(root) {
  const manifest = await read(root, 'manifest.json');
  let routes = {};
  for (const file of manifest.files) {
    const layer = await read(root, file);
    routes = { ...routes, ...layer.routes };
  }
  return routes;
}
