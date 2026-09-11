function parent(document, segments) {
  return segments.slice(0, -1).reduce((node, key) => node[key], document);
}
export function apply(document, patches, factory) {
  for (const patch of patches) {
    if (!Array.isArray(patch.path) || !patch.path.length) throw new Error('Invalid path');
    const key = patch.path.at(-1);
    if (patch.op === 'set') parent(document, patch.path)[key] = structuredClone(patch.value);
    else if (patch.op === 'reset') parent(document, patch.path)[key] = structuredClone(parent(factory, patch.path)[key]);
    else throw new Error('Unknown operation');
  }
  return document;
}
