import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('diagnostics reject arbitrary data and cap output', () => {
  const logs = [];
  const listeners = {};
  const window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(readFileSync('public/motion/diagnostics.js', 'utf8'), {
    window, HTMLImageElement: class {}, console: { warn: (...args) => logs.push(args) },
  });
  window.KalaayanaDiagnostics.report('private enquiry text');
  assert.equal(logs.length, 0);
  listeners.unhandledrejection({ reason: new Error('secret@example.com') });
  for (let i = 0; i < 30; i++) window.KalaayanaDiagnostics.report('contact_failed');
  assert.equal(logs.length, 20);
  assert.ok(!JSON.stringify(logs).includes('secret@example.com'));
  assert.deepEqual(Object.keys(logs[0][1]), ['event', 'time']);
});
