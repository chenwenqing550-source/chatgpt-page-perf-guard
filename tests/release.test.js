const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release metadata is consistently v1.6.1', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.equal(manifest.version, '1.6.1');
  assert.match(popup, />v1\.6\.1</);
  assert.match(styles, /v1\.6\.1/);
});
