const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'core.js'), 'utf8');
const monitorSource = fs.readFileSync(path.join(__dirname, '..', 'extension', 'monitor.js'), 'utf8');

function element() {
  return {
    setAttribute() {},
    removeAttribute() {},
    clientHeight: 800,
    getBoundingClientRect() { return { top: 0, bottom: 100 }; }
  };
}

function makeContext({ includePerformanceObserver = true, namespace = 'browser' } = {}) {
  let listener = null;
  const api = {
    runtime: {
      onMessage: {
        addListener(fn) { listener = fn; }
      }
    }
  };
  const root = element();
  const context = {
    console,
    performance: { now: () => 1000 },
    document: {
      hidden: false,
      documentElement: root,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    window: { innerHeight: 800 },
    location: { pathname: '/c/12345678-1234-1234-1234-123456789abc' },
    requestAnimationFrame() {},
    setInterval() { return 1; },
    clearInterval() {},
    CSS: { supports: () => true }
  };
  if (namespace === 'browser') context.browser = api;
  if (namespace === 'chrome') context.chrome = api;
  if (includePerformanceObserver) {
    class PerformanceObserver {
      static supportedEntryTypes = [];
      constructor() {}
      observe() {}
    }
    context.PerformanceObserver = PerformanceObserver;
  }
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  return { context, getListener: () => listener };
}

test('monitor loads when PerformanceObserver is unavailable', () => {
  const { context } = makeContext({ includePerformanceObserver: false, namespace: 'browser' });
  assert.doesNotThrow(() => vm.runInContext(monitorSource, context));
});

test('monitor registers messaging through browser namespace when chrome is absent', () => {
  const { context, getListener } = makeContext({ includePerformanceObserver: true, namespace: 'browser' });
  vm.runInContext(monitorSource, context);
  assert.equal(typeof getListener(), 'function');
});

test('history calibration keeps unknown assetCount as null across runtime message boundary', () => {
  const { context, getListener } = makeContext({ includePerformanceObserver: true, namespace: 'browser' });
  vm.runInContext(monitorSource, context);
  const listener = getListener();
  let response;
  listener({
    type: 'setHistoryCalibration',
    summary: {
      valid: true,
      sourceKind: 'openai_export',
      conversationId: '12345678-1234-1234-1234-123456789abc',
      messageCount: 10,
      assetCount: null,
      depthLevel: 'low'
    }
  }, {}, (value) => { response = value; });
  assert.equal(response.ok, true);
  assert.equal(response.calibration.assetCount, null);
});


test('history calibration treats non-numeric assetCount as unknown', () => {
  const { context, getListener } = makeContext({ includePerformanceObserver: true, namespace: 'browser' });
  vm.runInContext(monitorSource, context);
  const listener = getListener();
  let response;
  listener({
    type: 'setHistoryCalibration',
    summary: {
      valid: true,
      sourceKind: 'context_bridge',
      conversationId: '12345678-1234-1234-1234-123456789abc',
      messageCount: 10,
      assetCount: 'UNKNOWN',
      depthLevel: 'low'
    }
  }, {}, (value) => { response = value; });
  assert.equal(response.calibration.assetCount, null);
});
