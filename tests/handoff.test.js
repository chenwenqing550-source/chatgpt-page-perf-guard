const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'handoff.js'), 'utf8');

function loadHandoff() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.CGPTHandoff;
}

test('handoff prompt preserves state semantics and exact engineering identity', () => {
  const Handoff = loadHandoff();
  const prompt = Handoff.buildPrompt();
  for (const token of ['CURRENT', 'VERIFIED', 'PENDING', 'BLOCKED', 'HISTORICAL', 'REJECTED']) {
    assert.match(prompt, new RegExp(token));
  }
  for (const token of ['repo', 'branch', 'exact SHA', 'version', 'test result', '下一步', 'Stop Rule']) {
    assert.match(prompt, new RegExp(token));
  }
  assert.match(prompt, /UNKNOWN/);
});

test('handoff source never auto-sends or opens a new chat', () => {
  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.doesNotMatch(source, /requestSubmit\s*\(/);
  assert.doesNotMatch(source, /\.submit\s*\(/);
  assert.doesNotMatch(source, /KeyboardEvent/);
  assert.doesNotMatch(source, /window\.open\s*\(/);
});

test('handoff source does not extract conversation body text', () => {
  assert.doesNotMatch(source, /querySelectorAll\s*\(.*message-author-role/);
  assert.doesNotMatch(source, /conversation-turn-/);
});
