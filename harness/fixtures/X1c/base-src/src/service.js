import { parseTrayList } from './trays.js';

export function trayRows(text) {
  return parseTrayList(text).map((name, position) => ({ name, position }));
}
