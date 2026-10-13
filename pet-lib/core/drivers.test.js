// pet-lib/core/drivers.test.js
import { test, expect } from 'bun:test';
import { StateDriver } from './state-driver.js';
import { ChainDriver } from './chain-driver.js';

function capture(driver) {
  const calls = [];
  driver.onAction((action, meta) => calls.push([action, meta]));
  return calls;
}

test('StateDriver：对象形式的 stateActions 把 expression/gesture/voice 放进 meta', () => {
  const d = new StateDriver({ stateActions: { THINKING: { action: 'idle', expression: 'neutral', gesture: 'tilt', voice: 'thinking' } } });
  const calls = capture(d);
  d.feed({ type: 'agent.thinking' });
  expect(calls.at(-1)).toEqual(['idle', { loop: true, kind: 'THINKING', expression: 'neutral', gesture: 'tilt', voice: 'thinking' }]);
  d.stop();
});

test('StateDriver：字符串形式保持旧行为', () => {
  const d = new StateDriver({ stateActions: { THINKING: 'nod' } });
  const calls = capture(d);
  d.feed({ type: 'agent.thinking' });
  expect(calls.at(-1)).toEqual(['nod', { loop: true, kind: 'THINKING' }]);
  d.stop();
});

test('StateDriver：对象没有 action 时回落 idleAction', () => {
  const d = new StateDriver({ stateActions: { ERROR: { expression: 'sad' } }, idleAction: 'idle' });
  const calls = capture(d);
  d.feed({ type: 'task.failed' });
  expect(calls.at(-1)[0]).toBe('idle');
  expect(calls.at(-1)[1].expression).toBe('sad');
  d.stop();
});

test('ChainDriver.click：对象形式的 clicks', () => {
  const d = new ChainDriver({ clicks: [{ action: 'fidget-2', expression: 'smile', voice: 'hello' }] });
  const calls = capture(d);
  d.click();
  expect(calls.at(-1)).toEqual(['fidget-2', { loop: false, kind: 'CLICK', expression: 'smile', voice: 'hello' }]);
  d.stop();
});

test('ChainDriver.click：字符串形式保持旧行为', () => {
  const d = new ChainDriver({ clicks: ['click-happy'] });
  const calls = capture(d);
  d.click();
  expect(calls.at(-1)).toEqual(['click-happy', { loop: false, kind: 'CLICK' }]);
  d.stop();
});
