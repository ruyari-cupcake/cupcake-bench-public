import { createDocument } from './document.js';
import { createSession } from './session.js';
import { loadDocument } from './storage.js';
import { mountEditor } from './ui.js';

let initial = createDocument(), initialError;
try { initial = loadDocument(localStorage) ?? initial; }
catch (error) { initialError = error; }
export const session = createSession(initial);
export const ui = mountEditor(session, localStorage);
window.logbook = { getDocument: () => session.get(), setDocument: doc => session.commit(doc), session };
ui.status(initialError ? `Error: saved document could not be loaded (${initialError.message})` : 'Ready');
