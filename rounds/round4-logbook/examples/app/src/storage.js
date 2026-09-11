import { validateDocument } from './document.js';
export const STORAGE_KEY = 'logbook.document.v2';
export function saveDocument(storage, doc) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(validateDocument(doc))); return { ok: true }; }
  catch (error) { return { ok: false, error: String(error.message ?? error) }; }
}
export function loadDocument(storage) {
  const text = storage.getItem(STORAGE_KEY);
  return text === null ? null : validateDocument(JSON.parse(text));
}
