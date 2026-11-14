import assert from 'node:assert/strict';
import { test } from 'node:test';
import { robustRange } from './scale.ts';

test('robustRange leaves a single huge epoch outside the typical range', () => {
  const pts = [10, -5, 3, 8, -2, 6].map((v) => ({ v, e: 4 })).concat({ v: 5000, e: 50 });
  const typical = robustRange(pts, 5);
  assert.ok(typical.hi < 5000 && typical.hi >= 14, JSON.stringify(typical));
  assert.equal(typical.lo, -9);
  assert.deepEqual(robustRange(pts, Infinity), { lo: -9, hi: 5050 });
});

test('robustRange keeps everything when there is no outlier, and always spans zero', () => {
  const pts = [100, 120, 110].map((v) => ({ v, e: 5 }));
  assert.deepEqual(robustRange(pts, 5), { lo: 0, hi: 125 });
});
