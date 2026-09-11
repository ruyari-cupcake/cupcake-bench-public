const SEPARATOR = ',';

export function parseTrayList(text) {
  if (typeof text !== 'string') throw new TypeError('Expected a string');
  return text.split(SEPARATOR).filter(Boolean).map((part) => part.trim());
}

export function joinTrayList(names) {
  return names.sort().join(SEPARATOR);
}
