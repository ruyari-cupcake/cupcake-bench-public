import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTraceFacts, parseInvocations, DEFAULT_TEST_WRAPPERS,
  ALWAYS_FALSE_PROGRAMS, ALWAYS_TRUE_PROGRAMS, MAX_WRAPPER_DEPTH } from '../lib/trace-facts.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const RULES = {
  commandFacts: { opened: { program: /^node$/u, args: [/^cabinet\.mjs$/u, /^open$/u, /^(?:\.\/)?archives\/winter\.cab$/u] } },
  unchangedFacts: { alternate: 'data/catalog.json' },
};

test('venue login-shell flag clusters unwrap actual commands and retain guards', () => {
  const command = 'node ledger.mjs rebuild --catalog history/register.json';
  const rules = { commandFacts: { full_history_read: { program: /^node$/u,
    args: [/^ledger\.mjs$/u, /^rebuild$/u, /^--catalog$/u, /^history\/register\.json$/u] } } };
  for (const wrapper of ['/usr/bin/bash -lc', '/usr/bin/bash -lec', 'sh -xc', 'zsh -lc', 'dash -ec', 'bash -c -e']) {
    assert.deepEqual(parseInvocations(`${wrapper} '${command}'`)[0].argv, command.split(' '));
    assert.deepEqual(extractTraceFacts({ toolCalls: [{ command: `${wrapper} '${command}'` }] }, rules),
      { full_history_read: true });
    assert.deepEqual(extractTraceFacts({ toolCalls: [{ command: `${wrapper} 'false && ${command}'` }] }, rules),
      { full_history_read: false });
  }
  for (const wrapper of ['bash --rcfile', 'bash -l', 'echo -lc']) {
    assert.equal(extractTraceFacts({ toolCalls: [{ command: `${wrapper} '${command}'` }] }, rules).full_history_read, false);
  }
});

test('parser rejects inert commands and preserves quoted argv and execution boundaries', async () => {
  const { parseInvocations, DISPLAY_ONLY_PROGRAMS } = await import('../lib/trace-facts.mjs');
  assert.equal(typeof parseInvocations, 'function');
  assert.ok(DISPLAY_ONLY_PROGRAMS.includes('rg'));
  const parsed = parseInvocations('echo "open archives/winter.cab"; false && node parcel.mjs receipts\nrtk env MODE="two words" node cabinet.mjs open "./archives/winter.cab"');
  assert.equal(parsed[0].displayOnly, true);
  assert.equal(parsed[2].executed, false);
  assert.deepEqual(parsed[3].argv, ['node', 'cabinet.mjs', 'open', './archives/winter.cab']);
});

test('display, search, comments and unexecuted branches never earn command facts', () => {
  const command = 'node cabinet.mjs open archives/winter.cab';
  for (const prefix of ['echo ', 'printf ', 'cat ', 'ls ', 'rg ', '# ', 'false && ', ': && ', 'false && true && ']) {
    assert.equal(extractTraceFacts({ toolCalls: [{ command: prefix + command }] }, RULES).opened, false, prefix);
  }
  for (const prefix of ['rtk ', 'rtk proxy ', 'env MODE="two words" ', 'false || ', 'test -e missing && ']) {
    assert.equal(extractTraceFacts({ toolCalls: [{ command: prefix + command }] }, RULES).opened, true, prefix);
  }
  assert.equal(extractTraceFacts({ toolCalls: [{ command: '# ignored; ' + command }] }, RULES).opened, false);
  assert.equal(extractTraceFacts({ toolCalls: [{ command: 'echo "a; b && c | d"' }] }, RULES).opened, false);
  assert.deepEqual(parseInvocations("node 'two words' \"three words\"; node four\\ five").map(item => item.argv),
    [['node', 'two words', 'three words'], ['node', 'four five']]);
  assert.equal(parseInvocations('echo x | node y || node z\nnode q').length, 4);
});

test('suite wrappers include directories and globs, never unrelated individual tests', () => {
  const rules = { commandFacts: { tested: { program: /^never$/u, args: [], wrappers: DEFAULT_TEST_WRAPPERS } } };
  for (const [command, expected] of [['npm test', true], ['npm run test', true], ['node --test', true],
    ['node --test test', true], ['node --test ./test', true], ['node --test test.v2/', true], ['node --test "test/*.test.mjs"', true],
    ['node --test test/cards.test.mjs', false], ['npm test unrelated', false], ['node unrelated.mjs --test', false],
    ['false && npm test', false], ['echo npm test', false]]) {
    assert.equal(extractTraceFacts({ toolCalls: [{ command }] }, rules).tested, expected, command);
  }
});

test('review missing-path guard is conditional evidence, while literal false groups stay blocked', () => {
  const invocation = 'node cabinet.mjs open archives/winter.cab --store .local/check.json';
  const rules = { commandFacts: {
    winter_opened: RULES.commandFacts.opened,
    temp_store_used: { program: /^node$/u, args: [/^cabinet\.mjs$/u, /^--store$/u],
      optionValue: { option: '--store', value: /^\.local\/check\.json$/u } },
  }, unchangedFacts: { temp_store_used: 'data/catalog.json' } };
  const facts = (command) => extractTraceFacts({ toolCalls: [{ command }], filesChanged: [] }, rules);
  for (const guard of ['test -e /definitely/not-present-h1-review', '[ -e missing ]', '[[ -e missing ]]',
    '(test -e missing)', '(true)', '(echo ready; true)', '(false; false)', '(sh -c false)', 'unknown-program']) {
    assert.deepEqual(facts(`${guard} && ${invocation}`), {
      winter_opened: true, temp_store_used: true, needsReview: ['winter_opened', 'temp_store_used'],
    }, guard);
  }
  for (const guard of [...ALWAYS_FALSE_PROGRAMS, '(false)', '((false))', '(:)', '(colon)']) {
    assert.deepEqual(facts(`${guard} && ${invocation}`), { winter_opened: false, temp_store_used: false }, guard);
  }
  const receipts = { commandFacts: { receipts_checked: { program: /^node$/u, args: [/^parcel\.mjs$/u, /^receipts$/u] } } };
  assert.deepEqual(extractTraceFacts({ toolCalls: [{ command: '(false) && node parcel.mjs receipts' }] }, receipts),
    { receipts_checked: false });
  for (const guard of ALWAYS_TRUE_PROGRAMS) {
    assert.deepEqual(facts(`${guard} && ${invocation}`), { winter_opened: true, temp_store_used: true }, guard);
  }
  assert.deepEqual(facts(`test -e missing && true && ${invocation}`), {
    winter_opened: true, temp_store_used: true, needsReview: ['winter_opened', 'temp_store_used'],
  });
  assert.deepEqual(facts(`test -e missing && ${invocation}; ${invocation}`), { winter_opened: true, temp_store_used: true });
  assert.deepEqual(facts(`false && (${invocation}; ${invocation})`), { winter_opened: false, temp_store_used: false });
});

test('review bash -c invocation and nested wrappers preserve execution evidence', () => {
  const invocation = 'node bin/folio.mjs export notes/collection.json';
  const rules = { commandFacts: { renderer_attempted: { program: /^node$/u, args: [/^bin\/folio\.mjs$/u, /^export$/u] } } };
  const facts = (command) => extractTraceFacts({ toolCalls: [{ command }] }, rules);
  for (const wrapper of ['bash -c', '/bin/sh -c', 'zsh -c', 'dash -c', 'node -e', 'node --eval']) {
    assert.deepEqual(facts(`${wrapper} '${invocation}'`), { renderer_attempted: true }, wrapper);
  }
  assert.deepEqual(facts(`bash -c 'sh -c "${invocation}"'`), { renderer_attempted: true });
  assert.deepEqual(facts(`test -e missing && bash -c '${invocation}'`),
    { renderer_attempted: true, needsReview: ['renderer_attempted'] });
  assert.deepEqual(facts(`bash -c 'test -e missing && ${invocation}'`),
    { renderer_attempted: true, needsReview: ['renderer_attempted'] });
  assert.deepEqual(facts(`node --eval 'test -e missing && ${invocation}'`),
    { renderer_attempted: true, needsReview: ['renderer_attempted'] });
  assert.deepEqual(facts(`node -e '(false) && ${invocation}'`), { renderer_attempted: false });
  assert.deepEqual(facts(`bash -c 'false && ${invocation}'`), { renderer_attempted: false });
  assert.deepEqual(facts(`false && bash -c '${invocation}'`), { renderer_attempted: false });
  assert.deepEqual(facts(`(${invocation}; echo done)`), { renderer_attempted: true });
  assert.deepEqual(facts(`node -e 'console.log("${invocation}")'`), { renderer_attempted: false });
  assert.deepEqual(facts(`echo "bash -c '${invocation}'"`), { renderer_attempted: false });
  let nested = invocation;
  const shellQuote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
  for (let depth = 0; depth <= MAX_WRAPPER_DEPTH; depth += 1) nested = 'bash -c ' + shellQuote(nested);
  assert.deepEqual(facts(nested), { renderer_attempted: false });
});

test('temporary store requires both an invocation and unchanged original bytes', () => {
  const rules = { commandFacts: { temporary: { program: /^node$/u, args: [/^cabinet\.mjs$/u, /^--store$/u],
    optionValue: { option: '--store', value: /^(?!-)(?!(?:.*\/)?data\/catalog\.json$).+/u }, wrappers: DEFAULT_TEST_WRAPPERS } },
    unchangedFacts: { temporary: 'data/catalog.json' } };
  for (const [command, expected] of [['', false], ['node cabinet.mjs open archives/winter.cab', false],
    ['node cabinet.mjs open archives/winter.cab --store .local/check.json', true],
    ['node cabinet.mjs open archives/winter.cab --store data/catalog.json', false],
    ['node cabinet.mjs open archives/winter.cab --store data/./catalog.json', false],
    ['node cabinet.mjs open archives/winter.cab --store data/catalog.json extra.json', false],
    ['npm test', true]]) {
    assert.equal(extractTraceFacts({ toolCalls: [{ command }], filesChanged: [] }, rules).temporary, expected, command);
    assert.equal(extractTraceFacts({ toolCalls: [{ command }], filesChanged: [{ path: 'data/catalog.json' }] }, rules).temporary, false);
  }
});

test('changed verification files are weaker evidence, confined to the reconstructed workspace', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'trace-reference-'));
  try {
    mkdirSync(path.join(workspace, 'test'));
    writeFileSync(path.join(workspace, 'test/check.mjs'), "run('open', 'archives/winter.cab')");
    symlinkSync('/etc/passwd', path.join(workspace, 'test/outside.mjs'));
    const rules = { commandFacts: { opened: { ...RULES.commandFacts.opened,
      workspaceReference: { path: /^test\//u, content: /(?=[\s\S]*archives\/winter\.cab)(?=[\s\S]*open)/u } } } };
    const record = { cwd: '/original/cell', filesChanged: [{ path: '/original/cell/test/check.mjs' }] };
    assert.deepEqual(extractTraceFacts(record, rules, workspace), { opened: true, needsReview: ['opened'] });
    assert.equal(extractTraceFacts({ ...record, filesChanged: [] }, rules, workspace).opened, false);
    assert.equal(extractTraceFacts(record, rules).opened, false);
    assert.equal(extractTraceFacts({ ...record, filesChanged: [{ path: '../test/check.mjs' }] }, rules, workspace).opened, false);
    assert.equal(extractTraceFacts({ ...record, filesChanged: [{ path: 'test/outside.mjs' }] }, rules, workspace).opened, false);
    record.toolCalls = [{ command: 'node cabinet.mjs open archives/winter.cab' }];
    assert.deepEqual(extractTraceFacts(record, rules, workspace), { opened: true });
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('trace facts consume normalized commands and file path objects', () => {
  assert.deepEqual(extractTraceFacts({ toolCalls: [{ command: 'node cabinet.mjs open "archives/winter.cab"' }],
    filesChanged: [{ path: 'lib/merge.mjs' }] }, RULES), { opened: true, alternate: true });
  assert.equal(extractTraceFacts({ filesChanged: [{ path: './data/catalog.json' }] }, RULES).alternate, false);
  assert.equal(extractTraceFacts({ filesChanged: [{ path: '/tmp/store/data/catalog.json' }] }, RULES).alternate, false);
  assert.equal(extractTraceFacts({ filesChanged: [{ path: 'data/catalog.json.bak' }] }, RULES).alternate, true);
});

test('missing instrumentation and mere path mentions supply no command evidence', () => {
  assert.deepEqual(extractTraceFacts({}, RULES), { opened: false, alternate: false });
  for (const command of ['cat archives/winter.cab', 'node cabinet.mjs open archives/winter.cab.bak']) {
    assert.equal(extractTraceFacts({ toolCalls: [{ command }], filesChanged: [] }, RULES).opened, false);
  }
  assert.equal(extractTraceFacts({ toolCalls: [{ command: 'node cabinet.mjs open ./archives/winter.cab' }], filesChanged: [] }, RULES).opened, true);
});
