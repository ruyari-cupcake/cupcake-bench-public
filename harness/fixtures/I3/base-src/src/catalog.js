export function catalog(config) {
  return Object.entries(config.destinations).flatMap(([destination, entry]) => Object.entries(entry.accounts).map(([account, item]) => ({ destination, account, label: item.label })));
}
