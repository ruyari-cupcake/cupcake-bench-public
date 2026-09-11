/** Measured CLI protocol: tests/fixtures/claude-{answer,agentic}-stream.jsonl.
 * Translate at the provider boundary so grading, path auditing and outcome
 * classification continue to consume the Codex-shaped instrumentation contract.
 */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const LIST_TOOLS = new Set(['Glob', 'Grep', 'LS']);
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);

function normalizeTool(block) {
  const { name, input = {}, id } = block;
  const original = { id, claudeTool: { name, input } };
  if (name === 'Bash') return { type: 'command_execution', command: input.command, ...original };
  if (FILE_TOOLS.has(name)) return {
    type: 'file_change',
    changes: [{ path: input.file_path ?? input.notebook_path, kind: name === 'Write' ? 'add' : 'update' }],
    ...original,
  };
  if (name === 'Read') return { type: 'read_file', path: input.file_path, ...original };
  if (LIST_TOOLS.has(name)) return { type: 'list_directory', path: input.path ?? '.', ...original };
  return { type: 'tool_call', name, arguments: input, ...original };
}

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    input_tokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    cached_input_tokens: usage.cache_read_input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    reasoning_output_tokens: usage.output_tokens_details?.thinking_tokens ?? 0,
  };
}

export function parseClaudeStream(stdout) {
  const toolCalls = [];
  const usageSnapshots = [];
  const streamErrors = [];
  let lastText = '';
  let finalResult = null;
  let agentMessageCount = 0;
  let modelOutputObserved = false;
  let threadId = null;
  let anthropicUtilization = null;
  let malformedLines = 0;
  let webEvents = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event;
    try { event = JSON.parse(trimmed); }
    catch { malformedLines += 1; continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
      malformedLines += 1;
      continue;
    }
    threadId = event.session_id ?? threadId;
    if (event.type === 'assistant') {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        if (content.length) modelOutputObserved = true;
        const texts = content.filter((block) => block?.type === 'text' && typeof block.text === 'string');
        if (texts.length) { agentMessageCount += 1; lastText = texts.at(-1).text; }
        for (const block of content) {
          if (block?.type !== 'tool_use') continue;
          toolCalls.push(normalizeTool(block));
          if (WEB_TOOLS.has(block.name)) webEvents += 1;
        }
      }
      if (event.message?.usage) usageSnapshots.push(event.message.usage);
    } else if (event.type === 'result') {
      modelOutputObserved = true;
      finalResult = event;
      if (event.is_error === true) streamErrors.push(event.result ?? '');
      if (event.subtype !== 'success') streamErrors.push(event.subtype ?? 'unknown_result_subtype');
    } else if (event.type === 'rate_limit_event') {
      const windows = event.rate_limit_info?.unifiedWindows;
      anthropicUtilization = { fiveHour: windows?.five_hour?.utilization ?? null, sevenDay: windows?.seven_day?.utilization ?? null };
    } else if (event.type === 'error') {
      streamErrors.push(event.error?.message ?? event.message ?? JSON.stringify(event));
    }
  }
  const toolCallsByType = {};
  for (const tool of toolCalls) toolCallsByType[tool.type] = (toolCallsByType[tool.type] ?? 0) + 1;
  // Assistant snapshots can repeat across streamed blocks. Only the terminal
  // cumulative usage is a cell total; an interrupted cell's total stays unknown.
  const providerUsage = finalResult?.usage ?? null;
  return {
    answer: finalResult?.is_error === false && typeof finalResult.result === 'string' ? finalResult.result : lastText,
    agentMessageCount, modelOutputObserved, threadId,
    usage: normalizeUsage(providerUsage), usageSnapshots, usageSemantics: 'cumulative',
    completedTurnCount: finalResult?.num_turns ?? 0,
    turnCount: toolCalls.length, stepCount: toolCalls.length, toolCallCount: toolCalls.length,
    toolCallsByType, toolCalls, webEvents, malformedLines, streamErrors,
    providerUsage, costUsd: finalResult?.total_cost_usd ?? null, anthropicUtilization,
  };
}
