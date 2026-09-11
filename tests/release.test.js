const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('release metadata is consistently v1.7.1 candidate', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const popup = fs.readFileSync(path.join(root, 'extension', 'popup.html'), 'utf8');
  assert.equal(manifest.version, '1.7.1');
  assert.equal(pkg.version, '1.7.1');
  assert.match(popup, />v1\.7\.1</);

  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.equal(manifest.background && manifest.background.service_worker, 'background.js');
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('blackbox.js'));
  assert.ok(scripts.indexOf('blackbox.js') < scripts.indexOf('monitor.js'));
});

test('README and changelog present v1.7.1 as diagnostic candidate with browser acceptance pending', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

  assert.match(readme, /v1\.7\.1/);
  assert.match(readme, /诊断黑匣子/);
  assert.match(readme, /storage\.session|会话级.*存储|会话内.*存储/s);
  assert.match(readme, /PENDING/);
  assert.match(readme, /刷新|重载/);
  assert.match(readme, /未.*检查点|尚未.*检查点|未保存.*事件/s);
  assert.match(readme, /v1\.7\.0.*A\/B|A\/B.*v1\.7\.0/s);
  assert.match(readme, /页面压力.*模型上下文|模型上下文.*页面压力/s);
  assert.match(readme, /换窗交接/);
  assert.match(readme, /不会.*压缩.*服务端|不.*压缩.*服务端/s);

  assert.match(changelog, /## \[1\.7\.1\]/);
  assert.match(changelog, /诊断黑匣子/);
  assert.match(changelog, /PENDING/);
});

test('CI packages the v1.7.1 candidate artifact', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /chatgpt-page-perf-guard-v1\.7\.1-candidate\.zip/);
  assert.match(workflow, /name:\s*chatgpt-page-perf-guard-v1\.7\.1-candidate/);
});
