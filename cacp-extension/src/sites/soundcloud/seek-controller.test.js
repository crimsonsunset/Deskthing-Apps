import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSeekClickTarget } from './seek-controller.ts';

test('computeSeekClickTarget maps midpoint time to bar center', () => {
  const rect = { left: 100, top: 50, width: 200, height: 20 };
  const result = computeSeekClickTarget(rect, 50, 100);

  assert.equal(result.percentage, 0.5);
  assert.equal(result.clickX, 200);
  assert.equal(result.clickY, 60);
});

test('computeSeekClickTarget clamps time below zero to bar start', () => {
  const rect = { left: 80, top: 10, width: 400, height: 16 };
  const result = computeSeekClickTarget(rect, -10, 200);

  assert.equal(result.percentage, 0);
  assert.equal(result.clickX, 80);
  assert.equal(result.clickY, 18);
});

test('computeSeekClickTarget clamps time above duration to bar end', () => {
  const rect = { left: 0, top: 0, width: 300, height: 12 };
  const result = computeSeekClickTarget(rect, 999, 300);

  assert.equal(result.percentage, 1);
  assert.equal(result.clickX, 300);
  assert.equal(result.clickY, 6);
});

test('computeSeekClickTarget handles fractional ratio', () => {
  const rect = { left: 50, top: 20, width: 250, height: 10 };
  const result = computeSeekClickTarget(rect, 75, 300);

  assert.equal(result.percentage, 0.25);
  assert.equal(result.clickX, 112.5);
  assert.equal(result.clickY, 25);
});
