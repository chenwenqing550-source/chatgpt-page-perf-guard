const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const monitor = fs.readFileSync(path.join(root, 'monitor.js'), 'utf8');

test('content visibility applies only to explicitly cold turns', () => {
  assert.match(css, /data-cgpt-perf-cold="on"/);
  assert.doesNotMatch(css, /data-cgpt-perf-opt="on"\]\s+article\[data-testid\^="conversation-turn-"\]\s*\{/);
});

test('monitor manages cold turns through intersection preheat', () => {
  assert.match(monitor, /IntersectionObserver/);
  assert.match(monitor, /rootMargin/);
  assert.match(monitor, /data-cgpt-perf-cold/);
});

test('last and recently mutated turns are protected from cold state', () => {
  assert.match(monitor, /lastProtected/);
  assert.match(monitor, /turnMutationAt/);
  assert.match(monitor, /COLD_STABLE_MS/);
});

test('cold maintenance is gated by quiet layout policy', () => {
  assert.match(monitor, /shouldRunLayoutWork/);
  assert.match(monitor, /maintainColdTurns/);
});
