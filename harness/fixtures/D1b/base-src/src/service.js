import { locate } from './model.js';

export function prepare(row, settings) {
  return Math.trunc(locate(row, settings));
}
