const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'blackbox.js'), 'utf8');

test('black box hot recorder uses circular slots instead of array-shifting eviction', () => {
  assert.match(source, /writeIndex/);
  assert.match(source, /slots/);
  assert.doesNotMatch(source, /\.shift\(\)/, 'hot recorder must not shift an array');
});
