export function createPool(workers) {
  return workers.map((worker, index) => ({ ...worker, position: index }));
}
