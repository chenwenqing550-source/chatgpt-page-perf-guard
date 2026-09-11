const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const monitor = fs.readFileSync(path.join(root, 'monitor.js'), 'utf8');
const blackbox = fs.readFileSync(path.join(root, 'blackbox.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function functionBody(name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const match = signature.exec(monitor);
  assert.ok(match, `${name} must exist`);
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < monitor.length; index += 1) {
    const char = monitor[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    if (depth === 0) return monitor.slice(start, index);
  }
  assert.fail(`${name} must have a balanced function body`);
}

test('black box module loads before monitor and monitor degrades safely if unavailable', () => {
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('blackbox.js'));
  assert.ok(scripts.indexOf('blackbox.js') < scripts.indexOf('monitor.js'));
  assert.match(monitor, /CGPTPerfBlackBox/);
  assert.match(monitor, /createRecorder/);
  assert.match(monitor, /createNoopBlackBoxRecorder/);
});

test('send-time markers capture submit and unmodified Enter without reading input text', () => {
  assert.match(monitor, /function\s+markSend/);
  assert.match(monitor, /source:\s*"submit"/);
  assert.match(monitor, /event\.key\s*===\s*"Enter"/);
  assert.match(monitor, /!event\.shiftKey/);
  assert.doesNotMatch(monitor, /event\.target\.value/);
  assert.doesNotMatch(monitor, /\.innerText\b/);
});

test('scroll marker stays lightweight and records position only', () => {
  const body = functionBody('markScroll');
  assert.match(body, /scrollY/);
  assert.doesNotMatch(body, /scrollHeight|getBoundingClientRect|offset(?:Width|Height|Top|Left)|client(?:Width|Height|Top|Left)|getComputedStyle/);
});

test('LoAF observer forwards browser-provided layout attribution into black box', () => {
  assert.match(monitor, /sanitizeLoafEntry/);
  assert.match(blackbox, /forcedStyleAndLayoutDuration/);
  assert.match(blackbox, /styleAndLayoutStart/);
});

test('send and scroll hot paths do no serialization, storage, scans, or forced-layout reads', () => {
  for (const name of ['markSend', 'markScroll']) {
    const body = functionBody(name);
    const forbidden = [
      /JSON\.stringify/,
      /storage\./,
      /querySelectorAll/,
      /getBoundingClientRect/,
      /scrollHeight/,
      /offset(?:Width|Height|Top|Left)/,
      /client(?:Width|Height|Top|Left)/,
      /getComputedStyle/
    ];
    for (const pattern of forbidden) {
      assert.doesNotMatch(body, pattern, `${name} contains hot-path work: ${pattern}`);
    }
  }
});

test('monitor exposes black box status, manual mark, and explicit export messages', () => {
  for (const type of ['getBlackBoxStatus', 'markBlackBoxJank', 'getBlackBoxExport']) {
    assert.match(monitor, new RegExp(`message\\.type\\s*===\\s*"${type}"`));
  }
  assert.match(monitor, /captureWindow/);
  assert.match(monitor, /schemaVersion/);
  assert.match(monitor, /privacy/);
});

test('black box integration adds no fast recurring timer', () => {
  const timers = [...monitor.matchAll(/setInterval\([^,]+,\s*([A-Z_]+|\d+)\s*\)/g)].map((match) => match[1]);
  assert.ok(timers.includes('UPDATE_MS'));
  assert.doesNotMatch(monitor, /setInterval\([^,]+,\s*(?:[1-9]\d{0,2}|1\d{3})\s*\)/);
});
