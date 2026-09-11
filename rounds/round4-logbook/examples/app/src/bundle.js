import { validateDocument } from './document.js';
export const exportBundle = doc => JSON.stringify(validateDocument(doc), null, 2);
export const importBundle = text => validateDocument(JSON.parse(text));
