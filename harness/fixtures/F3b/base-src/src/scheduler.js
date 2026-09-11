export function install(context, save) {
  if (context.primary) context.register('tally', (rows) => Promise.all(rows.map(save)));
}
