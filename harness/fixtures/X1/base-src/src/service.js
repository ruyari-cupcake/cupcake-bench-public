import { removeLine } from './ticket.js';

export function removeFromTicket(ticket, id) {
  return { ...ticket, lines: removeLine(ticket.lines, id) };
}
