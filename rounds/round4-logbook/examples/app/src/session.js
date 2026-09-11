import { validateDocument } from './document.js';

export function createSession(initial) {
  let current = validateDocument(initial);
  const past = [], future = [], listeners = new Set();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  return {
    get: () => structuredClone(current),
    commit(next) {
      const valid = validateDocument(next); // Validate before touching history or notifying.
      past.push(current); current = valid; future.length = 0; notify();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    undo() { if (!past.length) return false; future.push(current); current = past.pop(); notify(); return true; },
    redo() { if (!future.length) return false; past.push(current); current = future.pop(); notify(); return true; },
  };
}
