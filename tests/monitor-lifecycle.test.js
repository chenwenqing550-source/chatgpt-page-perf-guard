const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimePath = path.join(__dirname, '..', 'extension', 'runtime.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const context = { globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(runtimeSource, context);
const Runtime = context.CGPTPerfRuntime;

test('background always suppresses active probes', () => {
  assert.equal(Runtime.classifyActivityState({ hidden: true }), 'background');
  assert.equal(Runtime.shouldRunActiveProbe('background', false), false);
});

test('scrolling, generating and busy suppress active/layout probes', () => {
  for (const state of ['scrolling', 'generating', 'busy']) {
    assert.equal(Runtime.shouldRunActiveProbe(state, false), false);
    assert.equal(Runtime.shouldRunLayoutWork(state, 5000), false);
  }
});

test('quiet with passive signals does not run active probe', () => {
  assert.equal(Runtime.shouldRunActiveProbe('quiet', true), false);
  assert.equal(Runtime.shouldRunActiveProbe('quiet', false), true);
});

test('quiet resumes only after stable window', () => {
  assert.equal(Runtime.classifyActivityState({ stableForMs: 1000 }), 'busy');
  assert.equal(Runtime.classifyActivityState({ stableForMs: 3000 }), 'quiet');
});

test('mutation and scroll combine into busy state', () => {
  assert.equal(Runtime.classifyActivityState({ scrollActive: true, mutationRate: 8, stableForMs: 0 }), 'busy');
  assert.equal(Runtime.classifyActivityState({ mutationRate: 8, stableForMs: 0 }), 'generating');
});

test('ring buffer stays bounded and preserves newest values', () => {
  const ring = Runtime.createRingBuffer(3);
  ring.push(1); ring.push(2); ring.push(3); ring.push(4);
  assert.deepEqual(Array.from(ring.values()), [2, 3, 4]);
  ring.clear();
  assert.deepEqual(Array.from(ring.values()), []);
});
