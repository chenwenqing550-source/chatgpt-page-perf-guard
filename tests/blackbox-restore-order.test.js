const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBlackBox() {
  const filename = path.join(__dirname, '..', 'extension', 'blackbox.js');
  const source = fs.readFileSync(filename, 'utf8');
  const sandbox = { globalThis: {}, URL, Date, Math, Number, String, Array, Object, JSON };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename });
  return sandbox.CGPTPerfBlackBox;
}

test('async restore merges older events chronologically with already-recorded samples', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 20, maxAgeMs: 600000 });

  recorder.record('sample', { phase: 'fresh' }, { perfTimeMs: 5000, wallTimeMs: 101000 });
  const restored = recorder.restore([
    { kind: 'send', perfTimeMs: 9000, wallTimeMs: 100000, data: { source: 'enter' } }
  ], { nowPerf: 5000, wallTimeMs: 101000 });

  assert.equal(restored.restored, 1);
  const events = Array.from(recorder.snapshot(5000));
  assert.deepEqual(events.map((event) => event.perfTimeMs), [4000, 5000]);
  assert.deepEqual(events.map((event) => event.kind), ['send', 'sample']);
  assert.equal(recorder.latestMarker('send', 5000).data.source, 'enter');

  const pruned = Array.from(recorder.snapshot(604500));
  assert.deepEqual(pruned.map((event) => event.perfTimeMs), [5000]);
  assert.deepEqual(pruned.map((event) => event.kind), ['sample']);
});
