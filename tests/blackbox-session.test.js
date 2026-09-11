const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const monitor = fs.readFileSync(path.join(root, 'monitor.js'), 'utf8');
const backgroundPath = path.join(root, 'background.js');
const background = fs.existsSync(backgroundPath) ? fs.readFileSync(backgroundPath, 'utf8') : '';

function functionBody(name) {
  const match = monitor.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm'));
  assert.ok(match, `${name} must exist`);
  return match[1];
}

test('manifest adds only session-storage capability and an MV3 service worker', () => {
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
});

test('background stores only bounded sanitized checkpoints in storage.session', () => {
  assert.equal(fs.existsSync(backgroundPath), true, 'background.js must exist');
  assert.match(background, /storage\.session/);
  assert.doesNotMatch(background, /storage\.(?:local|sync|managed)/);
  assert.match(background, /MAX_CHECKPOINT_EVENTS\s*=\s*600/);
  assert.match(background, /ALLOWED_EVENT_KEYS/);
  assert.match(background, /conversationId/);
  assert.match(background, /sender\.tab\.id/);
});

test('monitor never accesses extension storage directly', () => {
  assert.doesNotMatch(monitor, /\.storage\b/);
  assert.match(monitor, /blackBoxCheckpoint/);
  assert.match(monitor, /blackBoxRestore/);
});

test('checkpointing is quiet-state gated, low-frequency and backs off on excessive dispatch cost', () => {
  assert.match(monitor, /BLACK_BOX_CHECKPOINT_MS\s*=\s*30000/);
  assert.match(monitor, /BLACK_BOX_CHECKPOINT_BACKOFF_MS\s*=\s*120000/);
  assert.match(monitor, /BLACK_BOX_CHECKPOINT_BUDGET_MS\s*=\s*8/);
  assert.match(monitor, /activityState\s*!==\s*"quiet"/);
  assert.match(monitor, /checkpointDispatchMs/);
  assert.match(monitor, /checkpointBackoffUntil/);
});

test('send and scroll handlers cannot send checkpoint messages', () => {
  for (const name of ['markSend', 'markScroll']) {
    const body = functionBody(name);
    assert.doesNotMatch(body, /sendMessage|blackBoxCheckpoint|blackBoxRestore|JSON\.stringify/);
  }
});

test('severe incident checkpoint trigger is O(1) and does not scan recorder history', () => {
  assert.match(monitor, /function\s+noteSevereBlocking/);
  const body = functionBody('noteSevereBlocking');
  assert.doesNotMatch(body, /blackBox\.events|findSevereClusters|querySelector|reduce\s*\(/);
  assert.match(body, /pendingSevereCheckpoint/);
});
