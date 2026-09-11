const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.join(__dirname, '..', 'extension');
const coreSource = fs.readFileSync(path.join(extension, 'core.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(extension, 'runtime.js'), 'utf8');
const blackBoxSource = fs.readFileSync(path.join(extension, 'blackbox.js'), 'utf8');
const monitorSource = fs.readFileSync(path.join(extension, 'monitor.js'), 'utf8');

function makeContext() {
  let now = 1000;
  let messageListener = null;
  const documentListeners = new Map();
  const api = {
    runtime: {
      onMessage: {
        addListener(fn) { messageListener = fn; }
      }
    }
  };
  class MutationObserver {
    constructor() {}
    observe() {}
  }
  class PerformanceObserver {
    static supportedEntryTypes = [];
    constructor() {}
    observe() {}
  }
  const root = {
    setAttribute() {},
    removeAttribute() {}
  };
  const context = {
    console,
    URL,
    Date,
    performance: {
      now: () => now,
      timeOrigin: 100000
    },
    document: {
      hidden: false,
      readyState: 'complete',
      documentElement: root,
      querySelectorAll: () => [],
      addEventListener(type, fn) {
        if (!documentListeners.has(type)) documentListeners.set(type, []);
        documentListeners.get(type).push(fn);
      }
    },
    window: { innerHeight: 800, scrollX: 0, scrollY: 0 },
    location: { pathname: '/c/12345678-1234-1234-1234-123456789abc' },
    MutationObserver,
    PerformanceObserver,
    requestAnimationFrame() {},
    setInterval() { return 1; },
    clearInterval() {},
    CSS: { supports: () => true },
    browser: api
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  vm.runInContext(runtimeSource, context);
  vm.runInContext(blackBoxSource, context);
  vm.runInContext(monitorSource, context);

  function emit(type, event = {}) {
    for (const fn of documentListeners.get(type) || []) fn(event);
  }

  function send(message) {
    let response;
    const returned = messageListener(message, {}, (value) => { response = value; });
    return { returned, response };
  }

  return {
    context,
    emit,
    send,
    setNow(value) { now = value; }
  };
}

test('Enter and submit create send markers while Shift+Enter does not', () => {
  const runtime = makeContext();
  runtime.setNow(2000);
  runtime.emit('keydown', { key: 'Enter', shiftKey: false, isComposing: false });
  let status = runtime.send({ type: 'getBlackBoxStatus' }).response;
  assert.equal(status.ok, true);
  assert.equal(status.status.lastSendMarker.data.source, 'enter');

  runtime.setNow(3000);
  runtime.emit('keydown', { key: 'Enter', shiftKey: true, isComposing: false });
  status = runtime.send({ type: 'getBlackBoxStatus' }).response;
  assert.equal(status.status.lastSendMarker.perfTimeMs, 2000);

  runtime.setNow(4000);
  runtime.emit('submit', {});
  status = runtime.send({ type: 'getBlackBoxStatus' }).response;
  assert.equal(status.status.lastSendMarker.data.source, 'submit');
  assert.equal(status.status.lastSendMarker.perfTimeMs, 4000);
});

test('manual marker and explicit export are available through runtime messages', () => {
  const runtime = makeContext();
  runtime.setNow(5000);
  const marked = runtime.send({ type: 'markBlackBoxIncident' }).response;
  assert.equal(marked.ok, true);
  assert.equal(marked.status.lastManualMarker.kind, 'manual');

  const exported = runtime.send({ type: 'exportBlackBox', kind: 'manual' }).response;
  assert.equal(exported.ok, true);
  assert.equal(exported.payload.captureWindow, 'manual');
  assert.equal(exported.payload.privacy.chatTextCaptured, false);
});

test('monitor forwards browser-provided LoAF metadata to recorder', () => {
  for (const field of [
    'blockingDuration',
    'renderStart',
    'styleAndLayoutStart',
    'firstUIEventTimestamp',
    'scripts'
  ]) {
    assert.match(monitorSource, new RegExp(field));
  }
  assert.match(monitorSource, /blackBox\.record\(type/);
});

test('black box hot path has no forced-layout, serialization, or direct storage APIs', () => {
  const forbidden = [
    /getBoundingClientRect/,
    /\.offset(?:Height|Width|Top|Left)\b/,
    /\.client(?:Height|Width|Top|Left)\b/,
    /\.scrollHeight\b/,
    /getComputedStyle/,
    /JSON\.stringify/,
    /\.storage\b/
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(monitorSource, pattern, `hot-path capability matched: ${pattern}`);
  }
});

test('diagnostics add no new recurring timer beyond the existing three monitor intervals', () => {
  const intervals = monitorSource.match(/setInterval\s*\(/g) || [];
  assert.equal(intervals.length, 3);
});
