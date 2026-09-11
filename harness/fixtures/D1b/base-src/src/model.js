export function locate(row, settings) {
  return settings.shelves.indexOf(row.section);
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.length > 0;

export function validateDocument(document) {
  if (!isRecord(document) || !Array.isArray(document.rows)) throw new Error('Invalid input');
  const { settings } = document;
  if (!(isRecord(settings) && Array.isArray(settings.shelves) && settings.shelves.every(nonempty) && new Set(settings.shelves).size === settings.shelves.length && !settings.shelves.includes('desk'))) throw new Error('Invalid input');
  for (const row of document.rows) {
    if (!isRecord(row) || !nonempty(row.id) || !(nonempty(row.section))) throw new Error('Invalid input');
  }
  return document;
}
