import { randomUUID } from 'node:crypto';
import { appendContact, listContacts } from './store.js';
import { importBooks } from './importer.js';
import { domainCounts } from './report.js';

const DEFAULT_FILE = 'data/current.csv';
const file = process.env.BOOK_FILE ?? DEFAULT_FILE;
const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'add') {
    const [name, email = ''] = args;
    if (name === undefined) throw new Error('Expected name');
    const record = { id: randomUUID(), name, email };
    await appendContact(file, record);
  } else if (command === 'list') console.log(JSON.stringify(await listContacts(file)));
  else if (command === 'report') console.log(JSON.stringify(await domainCounts(file)));
  else if (command === 'import') {
    if (!args[0]) throw new Error('Expected directory');
    console.log(await importBooks(args[0], file));
  } else throw new Error('Unknown command');
} catch (error) { console.error(error.message); process.exitCode = 1; }
