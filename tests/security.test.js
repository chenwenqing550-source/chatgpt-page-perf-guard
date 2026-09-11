const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sourceFiles = ['core.js', 'monitor.js', 'popup.js'];

test('manifest stays least-privilege and only injects into chatgpt.com', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions || [], []);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.deepEqual(manifest.content_scripts.map((item) => item.matches), [['https://chatgpt.com/*']]);
  assert.equal(manifest.background, undefined);
});

test('runtime source has no network, persistent storage, dynamic code, or cookie APIs', () => {
  const source = sourceFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
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
    assert.doesNotMatch(source, pattern, `forbidden capability matched: ${pattern}`);
  }
});
