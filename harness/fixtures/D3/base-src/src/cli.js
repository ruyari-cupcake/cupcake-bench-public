import * as model from './model.js';
import * as io from './snapshot.js';
const fresh = () => model.createCatalog();
const add = (state, row) => model.addItem(state, row);
const view = (state) => ({ rows: model.listItems(state), meta: structuredClone(state.options) });
const edit = (state, id, changes) => model.reviseItem(state, id, changes);
const load = io.loadCatalog;
const save = io.saveCatalog;

const [command, file, ...args] = process.argv.slice(2);
try {
  if (!file) throw new Error('A file is required');
  if (command === 'create') {
    const state = fresh();
    for (const row of JSON.parse(args[0] ?? '[]')) add(state, row);
    await save(file, state);
    console.log(JSON.stringify(view(state)));
  } else if (command === 'show') {
    console.log(JSON.stringify(view(await load(file))));
  } else if (command === 'edit') {
    const state = await load(file);
    edit(state, args[0], JSON.parse(args[1]));
    await save(file, state);
    console.log(JSON.stringify(view(state)));
  } else throw new Error('Usage: create <file> <rows-json> | show <file> | edit <file> <id> <changes-json>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
