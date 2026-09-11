const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const pageFiles = ['core.js', 'runtime.js', 'blackbox.js', 'monitor.js', 'handoff.js', 'popup.js'];

test('manifest stays least-privilege and only injects into chatgpt.com', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.deepEqual(manifest.content_scripts.map((item) => item.matches), [['https://chatgpt.com/*']]);
  assert.deepEqual(manifest.background, { service_worker: 'background.js' });
});

test('page runtime has no network, page storage, extension storage, dynamic code, or cookie APIs', () => {
  const source = pageFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const forbidden = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /EventSource/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /\.storage\b/,
    /\.cookies\b/
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `forbidden page capability matched: ${pattern}`);
  }
});

test('background is local-only and may use storage.session but no persistent storage', () => {
  const file = path.join(root, 'background.js');
  assert.equal(fs.existsSync(file), true, 'background.js must exist');
  const source = fs.readFileSync(file, 'utf8');
  const forbidden = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /EventSource/,
    /\beval\s*\(/,
    /new\s+Function\s*\(/,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/,
    /storage\.(?:local|sync|managed)/,
    /\.cookies\b/
  ];
  assert.match(source, /storage\.session/);
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `forbidden background capability matched: ${pattern}`);
  }
});

test('handoff never auto-sends or programmatically opens another chat', () => {
  const source = fs.readFileSync(path.join(root, 'handoff.js'), 'utf8');
  const forbidden = [
    /\.click\s*\(/,
    /requestSubmit\s*\(/,
    /\.submit\s*\(/,
    /KeyboardEvent/,
    /window\.open\s*\(/
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `handoff auto-action matched: ${pattern}`);
  }
});
