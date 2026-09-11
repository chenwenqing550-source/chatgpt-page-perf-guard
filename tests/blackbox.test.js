const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBlackBox() {
  const filename = path.join(__dirname, '..', 'extension', 'blackbox.js');
  const source = fs.readFileSync(filename, 'utf8');
  const sandbox = {
    globalThis: {},
    URL,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    JSON
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename });
  return sandbox.CGPTPerfBlackBox;
}

test('recorder is fixed-capacity and discards oldest entries', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 3, maxAgeMs: 600000 });
  recorder.record('sample', { n: 1 }, { perfTimeMs: 100, wallTimeMs: 1000 });
  recorder.record('sample', { n: 2 }, { perfTimeMs: 200, wallTimeMs: 1100 });
  recorder.record('sample', { n: 3 }, { perfTimeMs: 300, wallTimeMs: 1200 });
  recorder.record('sample', { n: 4 }, { perfTimeMs: 400, wallTimeMs: 1300 });
  const events = recorder.snapshot(400);
  assert.deepEqual(Array.from(events, (item) => item.data.n), [2, 3, 4]);
});

test('snapshot prunes records older than maxAgeMs', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 10, maxAgeMs: 600000 });
  recorder.record('sample', { n: 1 }, { perfTimeMs: 1, wallTimeMs: 1 });
  recorder.record('sample', { n: 2 }, { perfTimeMs: 599999, wallTimeMs: 2 });
  recorder.record('sample', { n: 3 }, { perfTimeMs: 600100, wallTimeMs: 3 });
  const events = recorder.snapshot(600100);
  assert.deepEqual(Array.from(events, (item) => item.data.n), [2, 3]);
});

test('send and manual markers support bounded incident slicing', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 20, maxAgeMs: 600000 });
  recorder.record('sample', { label: 'pre' }, { perfTimeMs: 1000, wallTimeMs: 1000 });
  recorder.markSend('submit', { perfTimeMs: 10000, wallTimeMs: 10000 });
  recorder.record('long-animation-frame', { duration: 220 }, { perfTimeMs: 11000, wallTimeMs: 11000 });
  recorder.record('sample', { label: 'late' }, { perfTimeMs: 40000, wallTimeMs: 40000 });
  recorder.markManual({ perfTimeMs: 42000, wallTimeMs: 42000 });

  const sendSlice = recorder.sliceAroundMarker('send', 10000, 20000, 42000);
  assert.equal(sendSlice.marker.kind, 'send');
  assert.deepEqual(Array.from(sendSlice.events, (item) => item.kind), ['sample', 'send', 'long-animation-frame']);

  const manualSlice = recorder.sliceAroundMarker('manual', 5000, 5000, 42000);
  assert.equal(manualSlice.marker.kind, 'manual');
  assert.deepEqual(Array.from(manualSlice.events, (item) => item.kind), ['sample', 'manual']);
});

test('severe cluster requires repeated blocking evidence close in time', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 50, maxAgeMs: 600000 });
  recorder.record('long-animation-frame', { duration: 160, blockingDuration: 120 }, { perfTimeMs: 10000, wallTimeMs: 1 });
  recorder.record('long-animation-frame', { duration: 180, blockingDuration: 130 }, { perfTimeMs: 10400, wallTimeMs: 2 });
  recorder.record('longtask', { duration: 120 }, { perfTimeMs: 10800, wallTimeMs: 3 });
  recorder.record('long-animation-frame', { duration: 375, blockingDuration: 300 }, { perfTimeMs: 11200, wallTimeMs: 4 });
  const clusters = recorder.detectSevereClusters(12000);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 4);
  assert.equal(clusters[0].maxDuration, 375);
  assert.ok(clusters[0].totalDuration >= 835);
});

test('source URL sanitization strips query/hash and bounds strings', () => {
  const BlackBox = loadBlackBox();
  assert.equal(
    BlackBox.sanitizeSourceUrl('https://chatgpt.com/assets/app.js?token=secret#frag'),
    'https://chatgpt.com/assets/app.js'
  );
  assert.equal(BlackBox.sanitizeString('abcdef', 4), 'abcd');
});

test('LoAF script summaries are bounded and exclude arbitrary payload fields', () => {
  const BlackBox = loadBlackBox();
  const scripts = Array.from({ length: 12 }, (_, index) => ({
    duration: 100 + index,
    forcedStyleAndLayoutDuration: 50 + index,
    invoker: `invoker-${index}`,
    invokerType: 'event-listener',
    sourceURL: `https://chatgpt.com/assets/${index}.js?q=secret`,
    sourceFunctionName: `fn${index}`,
    windowAttribution: 'self',
    text: 'must-not-survive'
  }));
  const summary = BlackBox.summarizeLoafScripts(scripts);
  assert.equal(summary.length, 8);
  assert.equal(summary[0].sourceURL, 'https://chatgpt.com/assets/0.js');
  assert.equal('text' in summary[0], false);
});

test('export schema is metadata-only and marks privacy boundary', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 20, maxAgeMs: 600000 });
  recorder.markSend('enter', { perfTimeMs: 10000, wallTimeMs: 20000 });
  recorder.record('long-animation-frame', { duration: 200 }, { perfTimeMs: 10100, wallTimeMs: 20100 });
  const payload = recorder.buildExport('send', {
    nowPerf: 11000,
    exportedAt: '2026-09-12T00:00:00.000Z',
    pageTimeOrigin: '2026-09-11T23:00:00.000Z',
    conversationId: 'abc',
    optimizationEnabled: true
  });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.captureWindow, 'send');
  assert.equal(payload.privacy.chatTextCaptured, false);
  assert.equal(payload.privacy.uploaded, false);
  assert.ok(Array.isArray(payload.events));
  const serialized = JSON.stringify(payload);
  for (const forbidden of ['promptText', 'assistantText', 'chatText', 'innerHTML']) {
    assert.equal(new RegExp(`"${forbidden}"\\s*:`).test(serialized), false);
  }
});
