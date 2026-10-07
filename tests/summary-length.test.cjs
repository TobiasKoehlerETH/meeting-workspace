const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

test('summary length accepts integers and recovers from missing or corrupt preferences', () => {
  const { parseSummaryLines, getSummaryLines } = load('lib/summary-length.ts');
  for (const value of [null, '', 'invalid', 0, -1, 51, 2.5, Infinity]) {
    assert.equal(parseSummaryLines(value), 10);
  }
  assert.equal(parseSummaryLines('1'), 1);
  assert.equal(parseSummaryLines('50'), 50);
  assert.equal(getSummaryLines(), 10);
});
