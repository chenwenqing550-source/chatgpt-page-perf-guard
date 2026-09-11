const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.join(__dirname, '..', 'extension');
const coreSource = fs.readFileSync(path.join(extension, 'core.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));

function makeElement(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: tag.toUpperCase(),
    textContent: '',
    className: '',
    value: '',
    checked: true,
    disabled: false,
    files: [],
    style: {},
    href: '',
    download: '',
    clickCount: 0,
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { listeners.set(type, fn); },
    replaceChildren() {},
    appendChild() {},
    remove() {},
    click() { this.clickCount += 1; },
    _listeners: listeners
  };
}

function makeMetrics() {
  return {
    pagePressure: 4,
    windowPressure: 8,
    recommendationState: 'normal',
    coverage: 92,
    optimizationEnabled: true,
    status: 'running',
    blockingRatio: 1.9,
    jankRatio: 0,
    driftMs: 0.4,
    eventLatencyMs: 136,
    interactionCount: 2,
    loadedBlocks: 12,
    structureMode: 'fallback',
    transientBusy: false,
    historyAgeMs: 90000,
    supportedSignals: 4,
    expectedSignals: 4,
    foregroundRatio: 1,
    historyCalibration: null,
    currentConversationId: null,
    activityState: 'quiet',
    activeProbeSuppressed: true,
    selfWorkMs: 0.1,
    recentIncidents: []
  };
}

test('popup exposes three explicit black-box controls without downloads permission', () => {
  for (const id of ['markIncidentButton', 'exportSendIncidentButton', 'exportRecentBlackBoxButton', 'blackBoxStatus', 'blackBoxActionStatus']) {
    assert.match(popupHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.doesNotMatch(popupSource, /WebExt\.downloads|chrome\.downloads|browser\.downloads/);
});

test('black-box export serialization happens only in popup on explicit export action', () => {
  assert.match(popupSource, /exportBlackBox/);
  assert.match(popupSource, /JSON\.stringify/);
  assert.match(popupSource, /new Blob/);
  assert.match(popupSource, /URL\.createObjectURL/);
  assert.match(popupSource, /URL\.revokeObjectURL/);
  assert.match(popupSource, /downloadBlackBoxPayload/);
});

test('popup reads black-box status once on open, not on the 2-second metrics timer, and exports locally on click', async () => {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const createdAnchors = [];
  const messages = [];
  const timerCallbacks = [];
  const revoked = [];
  let urlCounter = 0;

  const browser = {
    tabs: {
      async query() { return [{ id: 7 }]; },
      async sendMessage(_tabId, message) {
        messages.push(message);
        if (message.type === 'getMetrics') return { ok: true, metrics: makeMetrics() };
        if (message.type === 'getBlackBoxStatus') {
          return {
            ok: true,
            status: {
              eventCount: 12,
              lastSendMarker: { wallTimeMs: Date.now() - 2000, kind: 'send', data: { source: 'enter' } },
              lastManualMarker: null,
              severeClusterCount: 1,
              latestSevereCluster: { count: 4, maxDuration: 375, totalDuration: 835 },
              checkpointState: 'session-saved'
            }
          };
        }
        if (message.type === 'markBlackBoxIncident') {
          return {
            ok: true,
            status: {
              eventCount: 13,
              lastSendMarker: null,
              lastManualMarker: { wallTimeMs: Date.now(), kind: 'manual', data: {} },
              severeClusterCount: 1,
              latestSevereCluster: { count: 4, maxDuration: 375, totalDuration: 835 },
              checkpointState: 'session-saved'
            }
          };
        }
        if (message.type === 'exportBlackBox') {
          return {
            ok: true,
            payload: {
              schemaVersion: 1,
              captureWindow: message.kind,
              privacy: { chatTextCaptured: false, uploaded: false },
              summary: { eventCount: 12, marker: message.kind === 'send' ? { kind: 'send' } : null },
              events: [{ kind: 'long-animation-frame', perfTimeMs: 1, wallTimeMs: 2, data: { duration: 180 } }]
            }
          };
        }
        throw new Error(`unexpected message ${message.type}`);
      }
    }
  };

  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options && options.type;
    }
  }

  const urlApi = {
    createObjectURL(blob) {
      assert.ok(blob instanceof FakeBlob);
      urlCounter += 1;
      return `blob:test-${urlCounter}`;
    },
    revokeObjectURL(url) { revoked.push(url); }
  };

  const context = {
    browser,
    Blob: FakeBlob,
    URL: urlApi,
    Date,
    document: {
      getElementById: getEl,
      createDocumentFragment: () => ({ appendChild() {} }),
      createElement(tag) {
        const element = makeElement(tag);
        if (tag === 'a') createdAnchors.push(element);
        return element;
      }
    },
    window: { addEventListener() {} },
    setInterval(fn) { timerCallbacks.push(fn); return 1; },
    clearInterval() {},
    setTimeout(fn) { fn(); return 1; },
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  vm.runInContext(popupSource, context);

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(messages.filter((item) => item.type === 'getMetrics').length, 1);
  assert.equal(messages.filter((item) => item.type === 'getBlackBoxStatus').length, 1);
  assert.match(getEl('blackBoxStatus').textContent, /12/);
  assert.match(getEl('blackBoxStatus').textContent, /严重事件簇 1/);

  assert.equal(timerCallbacks.length, 1);
  await timerCallbacks[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.filter((item) => item.type === 'getMetrics').length, 2);
  assert.equal(messages.filter((item) => item.type === 'getBlackBoxStatus').length, 1);

  await getEl('markIncidentButton')._listeners.get('click')();
  assert.equal(messages.filter((item) => item.type === 'markBlackBoxIncident').length, 1);
  assert.match(getEl('blackBoxActionStatus').textContent, /已标记/);

  await getEl('exportSendIncidentButton')._listeners.get('click')();
  const sendExport = messages.find((item) => item.type === 'exportBlackBox' && item.kind === 'send');
  assert.ok(sendExport);
  assert.equal(createdAnchors.length, 1);
  assert.equal(createdAnchors[0].clickCount, 1);
  assert.match(createdAnchors[0].download, /chatgpt-perf-send-.*\.json$/);
  assert.deepEqual(revoked, ['blob:test-1']);

  await getEl('exportRecentBlackBoxButton')._listeners.get('click')();
  const recentExport = messages.find((item) => item.type === 'exportBlackBox' && item.kind === 'recent');
  assert.ok(recentExport);
  assert.equal(createdAnchors.length, 2);
  assert.equal(createdAnchors[1].clickCount, 1);
});
