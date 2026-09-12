const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('release metadata is consistently v1.7.2 candidate', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const popup = fs.readFileSync(path.join(root, 'extension', 'popup.html'), 'utf8');
  assert.equal(manifest.version, '1.7.2');
  assert.equal(pkg.version, '1.7.2');
  assert.match(popup, />v1\.7\.2</);
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.equal(manifest.background && manifest.background.service_worker, 'background.js');
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('blackbox.js'));
  assert.ok(scripts.indexOf('blackbox.js') < scripts.indexOf('monitor.js'));
});

test('README and changelog distinguish geometry proof from pending real-browser acceptance', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(readme, /v1\.7\.2/);
  assert.match(readme, /诊断黑匣子/);
  assert.match(readme, /storage\.session/);
  assert.match(readme, /PENDING/);
  assert.match(readme, /刷新|重载/);
  assert.match(readme, /尚未检查点的事件可能丢失/);
  assert.match(readme, /v1\.7\.0.*A\/B/);
  assert.match(readme, /v1\.7\.1 vs v1\.7\.2/);
  assert.match(readme, /页面压力.*模型上下文/);
  assert.match(readme, /换窗交接/);
  assert.match(readme, /不会压缩当前服务端上下文/);
  assert.match(changelog, /## \[1\.7\.2\]/);
  assert.match(changelog, /诊断黑匣子/);
  assert.match(changelog, /PENDING/);
});

test('CI packages the v1.7.2 candidate artifact', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /chatgpt-page-perf-guard-v1\.7\.2-candidate\.zip/);
  assert.match(workflow, /name:\s*chatgpt-page-perf-guard-v1\.7\.2-candidate/);
});
