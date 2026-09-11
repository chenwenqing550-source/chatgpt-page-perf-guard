const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('release metadata is consistently v1.7.0', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const popup = fs.readFileSync(path.join(root, 'extension', 'popup.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'extension', 'styles.css'), 'utf8');
  assert.equal(manifest.version, '1.7.0');
  assert.equal(pkg.version, '1.7.0');
  assert.match(popup, />v1\.7\.0</);
  assert.match(styles, /v1\.7\.0/);
});

test('README presents only v1.7.0 as the current install target', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /v1\.7\.0/);
  assert.doesNotMatch(readme, /v1\.6\.1/);
  assert.match(readme, /页面压力.*模型上下文|模型上下文.*页面压力/s);
  assert.match(readme, /换窗交接/);
  assert.match(readme, /不会.*压缩.*服务端|不.*压缩.*服务端/s);
});
