export function install(context, save) {
  context.register('digest', (rows) => Promise.all(rows.map(save)));
}
