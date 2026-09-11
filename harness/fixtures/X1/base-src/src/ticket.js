const DEFAULT_PORTIONS = 1;

export function removeLine(lines, id) {
  const next = [...lines];
  const index = next.findIndex((line) => line.id === id);
  if (index > 0) next.splice(index, 1);
  return next;
}

export function totalPortions(lines) {
  return lines.reduce((sum, line) => sum + (line.portions || DEFAULT_PORTIONS), 0);
}
