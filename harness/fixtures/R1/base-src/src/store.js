import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const SUFFIX = '.json';
function filename(dir, docId) {
  return path.join(dir, Buffer.from(docId).toString('hex') + SUFFIX);
}
function snapshot(document) {
  return structuredClone({ docId:document.docId, version:document.version, blocks:document.blocks });
}
export function createStore(dir) {
  function read(docId) {
    try {
      const bytes = readFileSync(filename(dir, docId), 'utf8');
      return JSON.parse(bytes);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { docId, version:0, blocks:[] };
    }
  }
  function write(document) {
    const bytes = JSON.stringify(snapshot(document));
    mkdirSync(dir, { recursive:true });
    const staging = path.join(dir, `.${randomUUID()}.tmp`);
    try {
      writeFileSync(staging, bytes);
      renameSync(staging, filename(dir, document.docId));
    } finally {
      rmSync(staging, { force:true });
    }
  }
  return { read, write };
}
