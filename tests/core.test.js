const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCore() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'core.js'), 'utf8'), context);
  return context.CGPTPerfCore;
}

test('Context Bridge keeps asset count UNKNOWN when neither count nor ledger exists', () => {
  const Core = loadCore();
  const result = Core.extractBridgeSummary({
    format: 'CHATGPT_CONTEXT_BRIDGE',
    current_state: {},
    raw_conversation: { mapping: {} }
  }, 123);

  assert.equal(result.valid, true);
  assert.equal(result.assetCount, null);
});

test('Context Bridge preserves an explicit zero asset count', () => {
  const Core = loadCore();
  const result = Core.extractBridgeSummary({
    format: 'CHATGPT_CONTEXT_BRIDGE',
    current_state: { asset_count: 0 },
    raw_conversation: { mapping: {} }
  });
  assert.equal(result.assetCount, 0);
});


test('Context Bridge treats non-numeric asset count as UNKNOWN', () => {
  const Core = loadCore();
  const result = Core.extractBridgeSummary({
    format: 'CHATGPT_CONTEXT_BRIDGE',
    current_state: { asset_count: 'UNKNOWN' },
    raw_conversation: { mapping: {} }
  });
  assert.equal(result.assetCount, null);
});

test('Context Bridge can recover asset count from ledger when explicit value is invalid', () => {
  const Core = loadCore();
  const result = Core.extractBridgeSummary({
    format: 'CHATGPT_CONTEXT_BRIDGE',
    current_state: { asset_count: 'UNKNOWN' },
    asset_ledger: [{}, {}],
    raw_conversation: { mapping: {} }
  });
  assert.equal(result.assetCount, 2);
});
