const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const extension = path.join(root, 'extension');
const docs = path.join(root, 'docs');

test('repository uses extension and docs directories', () => {
  assert.deepEqual(fs.readdirSync(extension).sort(), [
    'background.js', 'blackbox.js', 'core.js', 'handoff.js', 'manifest.json', 'monitor.js', 'popup.css', 'popup.html', 'popup.js', 'runtime.js', 'styles.css'
  ]);
  for (const file of ['architecture.md', 'compatibility.md', 'release-checklist.md', 'security.md']) {
    assert.equal(fs.existsSync(path.join(docs, file)), true, file);
  }
  for (const file of ['background.js', 'blackbox.js', 'core.js', 'handoff.js', 'manifest.json', 'monitor.js', 'popup.css', 'popup.html', 'popup.js', 'runtime.js', 'styles.css', 'SECURITY.md']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.check, /extension[\\/]core\.js/);
  assert.match(pkg.scripts.check, /extension[\\/]runtime\.js/);
  assert.match(pkg.scripts.check, /extension[\\/]blackbox\.js/);
  assert.match(pkg.scripts.check, /extension[\\/]background\.js/);
  assert.match(pkg.scripts.check, /extension[\\/]monitor\.js/);
  assert.match(pkg.scripts.check, /extension[\\/]handoff\.js/);
  assert.match(pkg.scripts.check, /extension[\\/]popup\.js/);
});
