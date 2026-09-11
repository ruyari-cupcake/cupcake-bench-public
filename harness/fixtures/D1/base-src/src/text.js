export function assess(dimensions) {
  return dimensions.every((length) => Number.isFinite(length) && length > 0);
}
