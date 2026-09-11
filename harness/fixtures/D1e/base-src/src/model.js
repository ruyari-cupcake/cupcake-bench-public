export function check(row, settings) {
  return !settings.closed.includes(row.slot);
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.length > 0;

export function validateDocument(document) {
  if (!isRecord(document) || !Array.isArray(document.rows)) throw new Error('Invalid input');
  const { settings } = document;
  if (!(isRecord(settings) && Array.isArray(settings.closed) && settings.closed.every(nonempty))) throw new Error('Invalid input');
  for (const row of document.rows) {
    if (!isRecord(row) || !nonempty(row.id) || !(nonempty(row.slot))) throw new Error('Invalid input');
  }
  return document;
}
