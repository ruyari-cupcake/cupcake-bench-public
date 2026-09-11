export function check(label) {
  return typeof label === 'string' && label.length <= 40;
}
