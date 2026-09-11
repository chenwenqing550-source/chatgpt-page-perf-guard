const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const sourceFiles = ['core.js', 'runtime.js', 'blackbox.js', 'monitor.js', 'handoff.js', 'popup.js', 'background.js'];

test('manifest stays least-privilege with session checkpoint storage only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.deepEqual(manifest.content_scripts.map((item) => item.matches), [['https://chatgpt.com/*']]);
  assert.equal(manifest.background && manifest.background.service_worker, 'background.js');
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
    /\.storage\.(?:local|sync)\b/,
    /\.cookies\b/
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(source, pattern, `forbidden capability matched: ${pattern}`);
  }

  const monitor = fs.readFileSync(path.join(root, 'monitor.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.doesNotMatch(monitor, /\.storage\b/, 'content script must not access extension storage directly');
  assert.match(background, /\.storage\.session\b/, 'background must use session storage');
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
