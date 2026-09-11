const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

function makeElement() {
  const listeners = new Map();
  return {
    textContent: '',
    className: '',
    value: '',
    checked: true,
    disabled: false,
    files: [],
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { listeners.set(type, fn); },
    replaceChildren() {},
    click() {},
    _listeners: listeners
  };
}

test('popup communicates through browser namespace when chrome is absent', async () => {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  let queryCalls = 0;
  let sendCalls = 0;
  const browser = {
    tabs: {
      async query() { queryCalls += 1; return [{ id: 7 }]; },
      async sendMessage() {
        sendCalls += 1;
        return {
          ok: true,
          metrics: {
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
            currentConversationId: null
          }
        };
      }
    }
  };
  const context = {
    browser,
    document: {
      getElementById: getEl,
      createDocumentFragment: () => ({ appendChild() {} }),
      createElement: () => makeElement()
    },
    window: { addEventListener() {} },
    setInterval() { return 1; },
    clearInterval() {},
    console
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(coreSource, context);
  vm.runInContext(popupSource, context);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queryCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(getEl('pagePressure').textContent, '4%');
});
