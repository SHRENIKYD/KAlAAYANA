import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVersion } from './bump-version.mjs';

test('advance the current release series without skipping a number', () => {
  assert.equal(nextVersion('1.2.11'), '1.2.12');
  assert.equal(nextVersion('1.2.12'), '1.2.13');
});
test('roll patch 99 into the next minor at 00', () => {
  assert.equal(nextVersion('1.2.99'), '1.3.00');
  assert.equal(nextVersion('1.20.99'), '1.21.00');
  assert.equal(nextVersion('1.21.00'), '1.21.01');
});
test('retain historic single-digit patch compatibility and reject invalid input', () => {
  assert.equal(nextVersion('1.2.8'), '1.2.09');
  for (const value of ['1.2.100', '1.02.12', 'v1.2.12', '1.2', '-1.2.12']) {
    assert.throws(() => nextVersion(value));
  }
});
