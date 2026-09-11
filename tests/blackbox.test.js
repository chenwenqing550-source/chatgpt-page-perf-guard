const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'extension', 'blackbox.js');

function loadApi() {
  assert.equal(fs.existsSync(file), true, 'extension/blackbox.js must exist');
  const source = fs.readFileSync(file, 'utf8');
  const context = { URL };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'blackbox.js' });
  assert.ok(context.CGPTPerfBlackBox, 'CGPTPerfBlackBox must be exposed');
  return context.CGPTPerfBlackBox;
}

test('recorder bounds capacity and prunes records older than the time window', () => {
  const api = loadApi();
  let wall = 1_000;
  let perf = 10;
  const recorder = api.createRecorder({
    maxItems: 3,
    windowMs: 1_000,
    nowWall: () => wall,
    nowPerf: () => perf
  });

  recorder.record({ kind: 'sample', value: 1 });
  wall = 1_400; perf = 20;
  recorder.record({ kind: 'sample', value: 2 });
  wall = 1_800; perf = 30;
  recorder.record({ kind: 'sample', value: 3 });
  wall = 2_100; perf = 40;
  recorder.record({ kind: 'sample', value: 4 });

  const events = recorder.events();
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((item) => item.value), [2, 3, 4]);
  assert.equal(events.at(-1).wallTimeMs, 2_100);
  assert.equal(events.at(-1).perfTimeMs, 40);
});

test('source URLs are sanitized and strings are bounded', () => {
  const api = loadApi();
  const value = api.sanitizeSourceUrl('https://chatgpt.com/assets/app.js?secret=1#fragment');
  assert.equal(value, 'https://chatgpt.com/assets/app.js');

  const long = `https://example.com/${'a'.repeat(500)}?token=hidden`;
  const bounded = api.sanitizeSourceUrl(long);
  assert.ok(bounded.length <= 180);
  assert.doesNotMatch(bounded, /token=hidden/);
});

test('LoAF sanitization keeps browser timing data and at most eight scripts', () => {
  const api = loadApi();
  const scripts = Array.from({ length: 12 }, (_, index) => ({
    duration: 100 + index,
    forcedStyleAndLayoutDuration: 50 + index,
    invoker: `handler-${index}`,
    invokerType: 'event-listener',
    sourceURL: `https://chatgpt.com/assets/${index}.js?query=private`,
    sourceFunctionName: `fn${index}`,
    windowAttribution: 'self'
  }));

  const result = api.sanitizeLoafEntry({
    startTime: 200,
    duration: 375,
    blockingDuration: 330,
    firstUIEventTimestamp: 205,
    renderStart: 250,
    styleAndLayoutStart: 260,
    scripts
  }, { wallTimeMs: 10_000, optimizationEnabled: true, activityState: 'busy' });

  assert.equal(result.kind, 'long-animation-frame');
  assert.equal(result.duration, 375);
  assert.equal(result.blockingDuration, 330);
  assert.equal(result.scripts.length, 8);
  assert.equal(result.scripts[0].forcedStyleAndLayoutDuration, 50);
  assert.equal(result.scripts[0].sourceURL, 'https://chatgpt.com/assets/0.js');
  assert.equal(result.optimizationEnabled, true);
  assert.equal(result.activityState, 'busy');
});

test('recorder detects a severe blocking cluster', () => {
  const api = loadApi();
  let wall = 1_000;
  const recorder = api.createRecorder({
    maxItems: 20,
    windowMs: 60_000,
    nowWall: () => wall,
    nowPerf: () => wall
  });

  for (const duration of [168, 159, 375, 166]) {
    recorder.record({ kind: 'long-animation-frame', duration });
    wall += 350;
  }

  const clusters = recorder.findSevereClusters();
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 4);
  assert.equal(clusters[0].maxDurationMs, 375);
});

test('send-centered export slices before and after the latest send marker', () => {
  const api = loadApi();
  let wall = 100_000;
  const recorder = api.createRecorder({
    maxItems: 50,
    windowMs: 600_000,
    nowWall: () => wall,
    nowPerf: () => wall - 90_000
  });

  recorder.record({ kind: 'sample', label: 'too-old' });
  wall = 109_000;
  recorder.record({ kind: 'sample', label: 'before' });
  wall = 110_000;
  recorder.mark('send', { source: 'submit' });
  wall = 115_000;
  recorder.record({ kind: 'long-animation-frame', duration: 200, label: 'after' });
  wall = 131_000;
  recorder.record({ kind: 'sample', label: 'too-late' });

  const exported = recorder.exportAroundLatestMarker(['send'], 10_000, 20_000);
  assert.equal(exported.marker.kind, 'send');
  assert.deepEqual(exported.events.map((item) => item.label).filter(Boolean), ['too-old', 'before', 'after']);
  assert.equal(exported.events.some((item) => item.label === 'too-late'), false);
});
