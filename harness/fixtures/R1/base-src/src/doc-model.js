export function apply(blocks, op) {
  const next = blocks.map(block => ({ ...block }));
  const index = next.findIndex(block => block.id === op.id);
  let effect = null;
  if (op.t === 'insert' && index < 0) {
    const found = next.findIndex(block => block.id === op.after);
    const position = op.after === null ? 0 : found < 0 ? next.length : found + 1;
    const anchor = position === 0 ? null : next[position - 1].id;
    next.splice(position, 0, { id:op.id, text:op.text });
    effect = { kind:'insert', id:op.id, text:op.text, anchor };
  } else if (op.t === 'update' && index >= 0) {
    effect = { kind:'update', id:op.id, text:op.text, prevText:next[index].text };
    next[index].text = op.text;
  } else if (op.t === 'delete' && index >= 0) {
    effect = { kind:'delete', id:op.id, prevText:next[index].text, anchor:index === 0 ? null : next[index - 1].id };
    next.splice(index, 1);
  }
  return { blocks:next, effect };
}
export function matches(blocks, effect) {
  if (!effect) return false;
  const block = blocks.find(block => block.id === effect.id);
  return effect.kind === 'delete' ? !block : !!block && block.text === effect.text;
}
export function invert(effect) {
  if (effect.kind === 'insert') return { t:'delete', id:effect.id };
  if (effect.kind === 'update') return { t:'update', id:effect.id, text:effect.prevText };
  return { t:'insert', after:effect.anchor, id:effect.id, text:effect.prevText };
}
