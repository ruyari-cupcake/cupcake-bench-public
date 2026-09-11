export function validateAmount(amount) {
  if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0)) {
    throw new TypeError('Invalid amount');
  }
}
