const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'blackbox.js'),
  'utf8'
);

test('recorder hot append path does not shift or front-splice arrays', () => {
  assert.doesNotMatch(source, /events\.shift\s*\(/);
  assert.doesNotMatch(source, /events\.splice\s*\(\s*0\s*,/);
});
