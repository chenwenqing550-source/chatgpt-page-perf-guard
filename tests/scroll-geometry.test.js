const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production monitor. Browser observations are supplied explicitly;
// no geometry getters are available, so the monitor cannot force layout here.
function harness({ resizeObserver = true } = {}) {
  let now = 0;
  let writes = 0;
  let message;
  let intersection;
  let resize;
  const intervals = new Map();
  const listeners = new Map();
  function element() {
    const attrs = new Map();
    const styles = new Map();
    return {
      nodeType: 1, isConnected: true,
      getAttribute: key => attrs.get(key) ?? null,
      hasAttribute: key => attrs.has(key),
      setAttribute(key, value) { writes++; attrs.set(key, value); },
      removeAttribute(key) { writes++; attrs.delete(key); },
      style: {
        setProperty(key, value) { writes++; styles.set(key, value); },
        removeProperty(key) { writes++; styles.delete(key); },
        getPropertyValue: key => styles.get(key) ?? ''
      },
      closest() { return this; }
    };
  }
  const nodes = Array.from({ length: 6 }, element);
  const root = element();
  const document = {
    documentElement: root, hidden: false, readyState: 'complete',
    querySelectorAll: selector => selector.startsWith('article') ? nodes.filter(node => node.isConnected) : [],
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    }
  };
  class IO {
    constructor(callback) { this.callback = callback; this.targets = new Set(); intersection = this; }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
  }
  class RO {
    constructor(callback) { this.callback = callback; this.targets = new Set(); resize = this; }
    observe(node) { this.targets.add(node); }
    unobserve(node) { this.targets.delete(node); }
  }
  class PO { static supportedEntryTypes = ['longtask']; observe() {} }
  const context = vm.createContext({
    document, console, URL, Date,
    location: { pathname: '/c/11111111-1111-1111-1111-111111111111' },
    performance: { now: () => now, timeOrigin: 1000000 },
    setInterval: (fn, delay) => intervals.set(delay, fn),
    requestAnimationFrame() {},
    IntersectionObserver: IO,
    ...(resizeObserver ? { ResizeObserver: RO } : {}),
    PerformanceObserver: PO,
    MutationObserver: class { observe() {} },
    chrome: { runtime: { onMessage: { addListener(fn) { message = fn; } } } }
  });
  for (const name of ['core.js', 'runtime.js', 'monitor.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', name), 'utf8'), context);
  }
  function tick(time) { now = time; intervals.get(2000)(); }
  function intersect(node, near) { intersection.callback([{ target: node, isIntersecting: near }]); }
  function measure(node, height, width = 600) {
    if (resize) resize.callback([{ target: node, contentRect: { height, width } }]);
  }
  tick(10000);
  for (const node of nodes) intersect(node, false);
  return {
    nodes, tick, intersect, measure,
    writes: () => writes,
    resize: () => resize,
    emit(type) { for (const fn of listeners.get(type) || []) fn({}); },
    request(value) { let response; message(value, {}, r => { response = r; }); return response; },
    cool() { nodes.forEach((node, i) => measure(node, 1200 + i * 300)); tick(20000); }
  };
}

const cold = node => node.getAttribute('data-cgpt-perf-cold');
const size = node => node.style.getPropertyValue('--cgpt-perf-block-size');

test('never cool an unmeasured turn with a guessed height', () => {
  const h = harness(); h.tick(20000);
  assert.equal(cold(h.nodes[0]), null);
});

test('cooling preserves each measured content-box height', () => {
  const h = harness(); h.cool();
  assert.equal(cold(h.nodes[0]), 'on');
  assert.equal(size(h.nodes[0]), '1200px');
  assert.equal(size(h.nodes[1]), '1500px');
});

test('near-viewport observations never write styles or remove containment', () => {
  const h = harness(); h.cool(); const before = h.writes();
  h.intersect(h.nodes[0], true);
  assert.equal(h.writes(), before);
  assert.equal(cold(h.nodes[0]), 'on');
});

test('a quiet maintenance pass retains auto containment on nearby historical turns', () => {
  const h = harness(); h.cool(); h.intersect(h.nodes[0], true); h.tick(30000);
  assert.equal(cold(h.nodes[0]), 'on');
});

test('recent turns remain uncontained', () => {
  const h = harness(); h.cool();
  assert.equal(cold(h.nodes[4]), null); assert.equal(cold(h.nodes[5]), null);
});

test('missing ResizeObserver safely disables new cooling', () => {
  const h = harness({ resizeObserver: false }); h.tick(20000);
  assert.equal(cold(h.nodes[0]), null);
});

test('resize callbacks only cache measurements; no DOM writes', () => {
  const h = harness(); const before = h.writes(); h.measure(h.nodes[0], 1234);
  assert.equal(h.writes(), before);
});

test('placeholder resize observations do not replace a real size', () => {
  const h = harness(); h.cool(); h.measure(h.nodes[0], 720); h.tick(30000);
  assert.equal(size(h.nodes[0]), '1200px');
});

test('width changes release stale cold sizes only in quiet maintenance', () => {
  const h = harness(); h.cool(); const before = h.writes();
  h.measure(h.nodes[0], 1200, 400);
  assert.equal(h.writes(), before);
  h.tick(30000);
  assert.equal(cold(h.nodes[0]), null);
  assert.equal(size(h.nodes[0]), '');
  h.measure(h.nodes[0], 2400, 400); h.tick(40000);
  assert.equal(size(h.nodes[0]), '2400px');
});

test('scrolling suppresses new layout maintenance', () => {
  const h = harness(); h.nodes.forEach(node => h.measure(node, 1800));
  h.tick(19000); h.emit('scroll'); h.tick(19500);
  assert.equal(cold(h.nodes[0]), null);
});

test('disabling optimization removes private size properties as well as markers', () => {
  const h = harness(); h.cool(); h.request({ type: 'toggleOptimization', enabled: false });
  assert.equal(cold(h.nodes[0]), null); assert.equal(size(h.nodes[0]), '');
});

test('disconnected turns are unobserved by both observers', () => {
  const h = harness(); h.cool(); h.nodes[0].isConnected = false; h.tick(30000);
  assert.ok(h.resize());
  assert.equal(h.resize().targets.has(h.nodes[0]), false);
});
