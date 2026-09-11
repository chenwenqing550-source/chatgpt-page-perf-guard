const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const monitor = fs.readFileSync(path.join(root, 'monitor.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('runtime helper loads before monitor', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('runtime.js'));
  assert.ok(scripts.indexOf('runtime.js') < scripts.indexOf('monitor.js'));
});

test('monitor consumes activity runtime and recent interaction age', () => {
  assert.match(monitor, /CGPTPerfRuntime/);
  assert.match(monitor, /interactionAgeMs/);
  assert.match(monitor, /classifyActivityState/);
});

test('active frame burst is not a fixed recurring main path', () => {
  assert.doesNotMatch(monitor, /setInterval\(runFrameBurst\s*,/);
  assert.match(monitor, /shouldRunActiveProbe/);
});

test('layout coverage work is gated by runtime quiet state', () => {
  assert.match(monitor, /shouldRunLayoutWork/);
  assert.match(monitor, /estimateCoverage/);
});

test('monitor tracks activity without reading chat body text', () => {
  assert.match(monitor, /MutationObserver/);
  assert.doesNotMatch(monitor, /\.innerText\b/);
  assert.doesNotMatch(monitor, /\.textContent\b/);
});

test('monitor exposes load-shedding diagnostics', () => {
  for (const field of ['activityState', 'activeProbeSuppressed', 'selfWorkMs', 'recentIncidents']) {
    assert.match(monitor, new RegExp(field));
  }
});
