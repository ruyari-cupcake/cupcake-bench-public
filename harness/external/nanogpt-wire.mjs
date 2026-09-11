/** Nano's gateway currently drops namespace tools. Preserve their identity across a
 * reversible flat-function boundary; never rewrite argument or reasoning bytes. */
export function flattenNamespaceRequest(request) {
  const body = structuredClone(request), mapping = {}, names = new Set();
  const add = name => {
    if (typeof name !== 'string' || !name || names.has(name)) throw Error('Ambiguous function identity');
    names.add(name);
  };
  if (body.tools) body.tools = body.tools.flatMap(tool => {
    if (tool.type !== 'namespace') { if (tool.name) add(tool.name); return [tool]; }
    if (typeof tool.name !== 'string' || !Array.isArray(tool.tools)) throw Error('Invalid namespace');
    return tool.tools.map(fn => {
      if (fn.type !== 'function' || typeof fn.name !== 'string') throw Error('Unsupported nested tool');
      const name = tool.name + '__' + fn.name;
      add(name);
      Object.defineProperty(mapping, name, { value: { namespace: tool.name, name: fn.name }, enumerable: true });
      return { ...fn, name };
    });
  });
  const flattenCall = call => {
    if (call?.type !== 'function_call' && call?.type !== 'function') return;
    if (!call.namespace) return;
    const name = call.namespace + '__' + call.name;
    if (!Object.hasOwn(mapping, name)) throw Error('Unknown namespaced call');
    call.name = name; delete call.namespace;
  };
  if (Array.isArray(body.input)) body.input.forEach(flattenCall);
  if (typeof body.tool_choice === 'object') flattenCall(body.tool_choice);
  return { body, mapping };
}
export function restoreNamespaceResponse(event, mapping) {
  const result = structuredClone(event);
  const restore = item => {
    if (item?.type === 'function_call' && Object.hasOwn(mapping, item.name)) Object.assign(item, mapping[item.name]);
  };
  restore(result.item);
  result.output?.forEach(restore);
  result.response?.output?.forEach(restore);
  return result;
}
