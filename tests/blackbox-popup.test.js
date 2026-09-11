const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extension = path.join(__dirname, '..', 'extension');
const html = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8');
const popup = fs.readFileSync(path.join(extension, 'popup.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));

test('popup exposes one compact black-box card with detailed status and three explicit actions', () => {
  for (const id of [
    'blackBoxStatus',
    'blackBoxEventCount',
    'blackBoxCheckpointState',
    'blackBoxLastSend',
    'blackBoxCluster',
    'exportSendIncidentButton',
    'exportRecentBlackBoxButton',
    'markIncidentButton',
    'blackBoxActionStatus'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
    assert.match(popup, new RegExp(id), id);
  }

  assert.match(html, /诊断黑匣子/);
  assert.match(html, /导出最近发送现场/);
  assert.match(html, /导出最近10分钟/);
  assert.match(html, /标记刚才卡顿/);
});

test('popup requests status and only serializes evidence during explicit export', () => {
  assert.match(popup, /getBlackBoxStatus/);
  assert.match(popup, /markBlackBoxIncident/);
  assert.match(popup, /exportBlackBox/);
  assert.match(popup, /kind:\s*["']send["']/);
  assert.match(popup, /kind:\s*["']recent["']/);
  assert.match(popup, /new\s+Blob\s*\(/);
  assert.match(popup, /JSON\.stringify\s*\(/);
  assert.match(popup, /URL\.createObjectURL/);
  assert.match(popup, /URL\.revokeObjectURL/);

  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.equal((manifest.permissions || []).includes('downloads'), false);
});

test('popup export stays local and black box status is not added to the two-second polling loop', () => {
  const refreshStart = popup.indexOf('async function refresh()');
  assert.ok(refreshStart >= 0);
  const nextFunction = popup.indexOf('\n  function ', refreshStart + 1);
  const nextAsyncFunction = popup.indexOf('\n  async function ', refreshStart + 1);
  const candidates = [nextFunction, nextAsyncFunction].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : popup.length;
  const refreshBody = popup.slice(refreshStart, end);
  assert.doesNotMatch(refreshBody, /getBlackBoxStatus/);

  for (const pattern of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /\.downloads\b/]) {
    assert.doesNotMatch(popup, pattern);
  }
});
