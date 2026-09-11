export function select(labels, prefix) {
  return labels.filter((label) => label.startsWith(prefix));
}
