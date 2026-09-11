import { load, save } from './storage.js';

const DEFAULT_VALUE = 720;
const valid = (value) => Number.isInteger(value) && value >= 0 && value <= 87600;

function selectValue(document) {
  if (Object.hasOwn(document.current, 'retentionHours')) return document.current.retentionHours;
  return Object.hasOwn(document.archive, 'retentionDays') ? document.archive.retentionDays * 24 : DEFAULT_VALUE;
}

function assignValue(document, value) {
  document.current.retentionHours = value;
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
