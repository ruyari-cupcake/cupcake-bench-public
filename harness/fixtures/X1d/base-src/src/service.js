export function takeSamples(rotation, count) {
  return Array.from({ length: count }, () => rotation.next());
}
