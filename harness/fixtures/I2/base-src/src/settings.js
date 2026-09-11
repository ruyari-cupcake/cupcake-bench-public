import { load, save } from './storage.js';

const DEFAULT_VALUE = "manual";
const valid = (value) => ['idle', 'manual', 'immediate'].includes(value);

function selectValue(document) {
  if (Object.hasOwn(document, 'savePolicy')) return document.savePolicy;
  return Object.hasOwn(document, 'autosave') ? (document.autosave ? 'immediate' : 'manual') : DEFAULT_VALUE;
}

function assignValue(document, value) {
  document.savePolicy = value;
}

export async function openSettings(directory) {
  const document = await load(directory);
  return selectValue(document);
}

export async function setSetting(directory, value) {
  if (!valid(value)) throw new Error('Invalid setting');
  const document = await load(directory);
  assignValue(document, value);
  await save(directory, document);
  return value;
}
