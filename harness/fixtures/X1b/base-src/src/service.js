export function availableSlots(calendar, requests) {
  return requests.filter(({ start, end }) => calendar.canReserve(start, end));
}
