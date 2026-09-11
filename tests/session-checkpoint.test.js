const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.join(__dirname, '..', 'extension');
const blackBoxSource = fs.readFileSync(path.join(extension, 'blackbox.js'), 'utf8');
const monitorSource = fs.readFileSync(path.join(extension, 'monitor.js'), 'utf8');

function loadBlackBox() {
  const sandbox = { globalThis: {}, URL, Date, Math, Number, String, Array, Object, JSON };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(blackBoxSource, sandbox, { filename: 'blackbox.js' });
  return sandbox.CGPTPerfBlackBox;
}

function loadBackground() {
  const backgroundSource = fs.readFileSync(path.join(extension, 'background.js'), 'utf8');
  let listener = null;
  const values = new Map();
  const session = {
    async get(key) {
      return key == null
        ? Object.fromEntries(values)
        : { [key]: values.get(key) };
    },
    async set(object) {
      for (const [key, value] of Object.entries(object || {})) values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    }
  };
  const browser = {
    storage: { session },
    runtime: {
      onMessage: {
        addListener(fn) { listener = fn; }
      }
    }
  };
  const context = { console, browser, chrome: undefined, globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });

  async function send(message, tabId = 7) {
    assert.equal(typeof listener, 'function');
    return listener(message, { tab: { id: tabId } });
  }

  return { send, values };
}

test('manifest grants only storage and declares MV3 session checkpoint worker', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.equal(manifest.background && manifest.background.service_worker, 'background.js');
});

test('background stores one bounded checkpoint slot per tab and isolates tabs', async () => {
  const runtime = loadBackground();
  const checkpoint = {
    schemaVersion: 1,
    conversationId: 'abc',
    savedAt: 123456,
    events: [
      { kind: 'send', perfTimeMs: 5000, wallTimeMs: 100000, data: { source: 'enter' } }
    ]
  };

  const saved = await runtime.send({ type: 'saveBlackBoxCheckpoint', checkpoint }, 7);
  assert.equal(saved.ok, true);
  assert.equal(runtime.values.size, 1);

  const loadedSameTab = await runtime.send({ type: 'loadBlackBoxCheckpoint' }, 7);
  assert.equal(loadedSameTab.ok, true);
  assert.equal(loadedSameTab.checkpoint.conversationId, 'abc');
  assert.equal(loadedSameTab.checkpoint.events.length, 1);

  const loadedOtherTab = await runtime.send({ type: 'loadBlackBoxCheckpoint' }, 8);
  assert.equal(loadedOtherTab.ok, true);
  assert.equal(loadedOtherTab.checkpoint, null);
});

test('background strips text-like fields and caps checkpoint event count', async () => {
  const runtime = loadBackground();
  const events = Array.from({ length: 600 }, (_, index) => ({
    kind: 'sample',
    perfTimeMs: index,
    wallTimeMs: 1000 + index,
    data: {
      pagePressure: 40,
      chatText: 'must-not-survive',
      promptText: 'must-not-survive',
      source: 'safe'
    }
  }));
  const saved = await runtime.send({
    type: 'saveBlackBoxCheckpoint',
    checkpoint: { schemaVersion: 1, conversationId: 'abc', savedAt: 2000, events }
  });
  assert.equal(saved.ok, true);

  const loaded = await runtime.send({ type: 'loadBlackBoxCheckpoint' });
  assert.ok(loaded.checkpoint.events.length <= 480);
  const serialized = JSON.stringify(loaded.checkpoint);
  assert.equal(serialized.includes('must-not-survive'), false);
});

test('clear removes only the current tab checkpoint', async () => {
  const runtime = loadBackground();
  await runtime.send({
    type: 'saveBlackBoxCheckpoint',
    checkpoint: { schemaVersion: 1, conversationId: 'a', savedAt: 1, events: [] }
  }, 7);
  await runtime.send({
    type: 'saveBlackBoxCheckpoint',
    checkpoint: { schemaVersion: 1, conversationId: 'b', savedAt: 1, events: [] }
  }, 8);

  const cleared = await runtime.send({ type: 'clearBlackBoxCheckpoint' }, 7);
  assert.equal(cleared.ok, true);
  assert.equal((await runtime.send({ type: 'loadBlackBoxCheckpoint' }, 7)).checkpoint, null);
  assert.equal((await runtime.send({ type: 'loadBlackBoxCheckpoint' }, 8)).checkpoint.conversationId, 'b');
});

test('restored events are rebased onto the new performance timeline using wall clock age', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 20, maxAgeMs: 600000 });
  const result = recorder.restore([
    { kind: 'send', perfTimeMs: 9000, wallTimeMs: 100000, data: { source: 'enter' } },
    { kind: 'longtask', perfTimeMs: 9100, wallTimeMs: 100100, data: { duration: 180 } }
  ], { nowPerf: 5000, wallTimeMs: 101000 });

  assert.equal(result.restored, 2);
  const events = Array.from(recorder.snapshot(5000));
  assert.equal(events[0].perfTimeMs, 4000);
  assert.equal(events[1].perfTimeMs, 4100);
  assert.equal(recorder.latestMarker('send', 5000).data.source, 'enter');
});

test('restore merges asynchronously returned old events ahead of newer in-page events', () => {
  const BlackBox = loadBlackBox();
  const recorder = BlackBox.createRecorder({ capacity: 20, maxAgeMs: 600000 });
  recorder.record('sample', { label: 'new-page' }, { perfTimeMs: 1000, wallTimeMs: 201000 });

  const result = recorder.restore([
    { kind: 'send', perfTimeMs: 9000, wallTimeMs: 199000, data: { source: 'enter' } },
    { kind: 'longtask', perfTimeMs: 9100, wallTimeMs: 199100, data: { duration: 180 } }
  ], { nowPerf: 1000, wallTimeMs: 201000 });

  assert.equal(result.restored, 2);
  const events = Array.from(recorder.snapshot(1000));
  assert.deepEqual(events.map((item) => item.kind), ['send', 'longtask', 'sample']);
  assert.deepEqual(events.map((item) => item.wallTimeMs), [199000, 199100, 201000]);
  assert.equal(events[0].perfTimeMs, -1000);
});

test('monitor checkpoints only from existing update path while quiet and has failure suspension', () => {
  assert.match(monitorSource, /CHECKPOINT_INTERVAL_MS\s*=\s*(?:60|90|120)\s*\*\s*1000/);
  assert.match(monitorSource, /activityState\s*!==\s*["']quiet["']/);
  assert.match(monitorSource, /saveBlackBoxCheckpoint/);
  assert.match(monitorSource, /loadBlackBoxCheckpoint/);
  assert.match(monitorSource, /blackBox\.restore/);
  assert.match(monitorSource, /checkpointSuspended/);

  const intervals = monitorSource.match(/setInterval\s*\(/g) || [];
  assert.equal(intervals.length, 3);

  for (const fnName of ['markSendMarker', 'markScroll']) {
    const start = monitorSource.indexOf(`function ${fnName}`);
    assert.ok(start >= 0, fnName);
    const next = monitorSource.indexOf('\n  function ', start + 1);
    const body = monitorSource.slice(start, next < 0 ? undefined : next);
    assert.doesNotMatch(body, /sendMessage|JSON\.stringify|\.storage\b/, `${fnName} must remain hot-path safe`);
  }
});
