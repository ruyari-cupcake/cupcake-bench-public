import { randomUUID } from 'node:crypto';
import { saveProfile, listProfiles } from './store.js';
import { importProfiles } from './importer.js';
import { themeCounts } from './report.js';

const DEFAULT_FILE = 'data/current.json';
const file = process.env.PROFILE_FILE ?? DEFAULT_FILE;
const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'set') {
    const [id, theme, home] = args;
    if (id === undefined || theme === undefined || home === undefined) throw new Error('Expected id, theme and home');
    const record = { id, theme, home, scale: 1 };
    await saveProfile(file, record);
  } else if (command === 'list') console.log(JSON.stringify(await listProfiles(file)));
  else if (command === 'report') console.log(JSON.stringify(await themeCounts(file)));
  else if (command === 'import') {
    if (!args[0]) throw new Error('Expected directory');
    console.log(await importProfiles(args[0], file));
  } else throw new Error('Unknown command');
} catch (error) { console.error(error.message); process.exitCode = 1; }
