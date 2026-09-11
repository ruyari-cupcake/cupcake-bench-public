const FILE = "profiles.json";
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function load(directory) {
  try { return JSON.parse(await readFile(path.join(directory, FILE), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {"active": "default", "profiles": {"default": {"options": {}}}}; throw error; }
}

export async function save(directory, document) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, FILE), JSON.stringify(document) + '\n');
}
