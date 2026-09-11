import { updateCounter } from './counter.js';

export function runEvents(initial, events) {
  return events.reduce(updateCounter, initial);
}
