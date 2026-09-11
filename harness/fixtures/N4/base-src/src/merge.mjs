export function merge(target, layer) {
  for (const [key, value] of Object.entries(layer)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {};
      merge(target[key], value);
    } else target[key] = structuredClone(value);
  }
  return target;
}
export function count(text) {
  if (!/^\d+$/.test(text)) throw new Error('Worker count must be an integer');
  return Number(text);
}
