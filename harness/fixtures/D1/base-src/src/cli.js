import { readFile, writeFile, rename } from 'node:fs/promises';
import { assess, validateDocument } from './model.js';
import { prepare } from './service.js';
import { runBatch } from './process.js';

function jsonValue(value) {
  return value instanceof Map ? { entries: [...value.entries()] } : value;
}

async function readJournal(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function main() {
  const [command, inputFile, journalFile] = process.argv.slice(2);
  if (command === 'show') {
    if (!inputFile) throw new Error('Expected journal path');
    console.log(JSON.stringify(await readJournal(inputFile)));
    return;
  }
  if (!['measure', 'preview', 'apply'].includes(command) || !inputFile) throw new Error('Expected command and input path');
  const document = validateDocument(JSON.parse(await readFile(inputFile, 'utf8')));
  if (command !== 'apply') {
    const values = [];
    for (const row of document.rows) {
      const result = command === 'measure' ? assess(row, document.settings) : prepare(row, document.settings);
      values.push({ asynchronous: result instanceof Promise, value: jsonValue(await result) });
    }
    console.log(JSON.stringify(values));
    return;
  }
  if (!journalFile) throw new Error('Expected journal path');
  const previous = await readJournal(journalFile);
  const additions = await runBatch(document);
  const journal = [...previous, ...additions];
  // Only a completed batch becomes the new durable journal.
  const staging = journalFile + '.stage';
  await writeFile(staging, JSON.stringify(journal) + '\n');
  await rename(staging, journalFile);
  console.log(JSON.stringify(additions));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
