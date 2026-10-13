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

test('ChainDriver：playMs 支持按动作的对象映射（含 default）', () => {
  const d = new ChainDriver({ playMs: { a: 123, default: 456 } });
  expect(d._ms('a')).toBe(123);
  expect(d._ms('b')).toBe(456);
  const d2 = new ChainDriver({ playMs: { a: 1 } });
  const ms = d2._ms('zzz');
  expect(ms).toBeGreaterThanOrEqual(8000);
  expect(ms).toBeLessThan(20000);
});

test('ChainDriver：hold 清掉定时器并在 ms 后 pickNext，不发动作；暂停时不排期', async () => {
  const d = new ChainDriver({ idle: ['idle'], playMs: 100000 });
  const calls = capture(d);
  d.start();
  expect(calls.length).toBe(1);
  let picked = 0;
  d.pickNext = () => { picked++; };
  d.hold(20);
  expect(calls.length).toBe(1);
  await new Promise((r) => setTimeout(r, 60));
  expect(picked).toBe(1);
  d.stop();
  d.hold(10);
  expect(d.timer).toBe(null);
  await new Promise((r) => setTimeout(r, 30));
  expect(picked).toBe(1);
});

test('ChainDriver.playMsFor：包装 _ms', () => {
  const d = new ChainDriver({ playMs: { a: 321 } });
  expect(d.playMsFor('a')).toBe(321);
  const ms = d.playMsFor('zzz');
  expect(ms).toBeGreaterThanOrEqual(8000);
});

const IDLE_CHAIN = { idle: ['idle'], playMs: { idle: 100000, 'fidget-2': 4321 }, clicks: [{ action: 'fidget-2', expression: 'smile', voice: 'hello' }] };

test('StateDriver：IDLE 时 hold / pickNext / playMsFor 委托给内部概率链', () => {
  const d = new StateDriver({ chain: IDLE_CHAIN });
  capture(d);
  d.start();
  const chain = d._idleChain;
  expect(chain).toBeTruthy();
  expect(d.playMsFor('fidget-2')).toBe(4321);
  const held = [];
  chain.hold = (ms) => held.push(ms);
  let picked = 0;
  chain.pickNext = () => { picked++; };
  d.hold(500);
  d.pickNext();
  expect(held).toEqual([500]);
  expect(picked).toBe(1);
  d.stop();
});

test('StateDriver：非 IDLE 或没有概率链时 hold / pickNext / playMsFor 为 no-op', () => {
  const d = new StateDriver({ chain: IDLE_CHAIN, stateActions: { THINKING: 'idle' } });
  capture(d);
  d.start();
  const chain = d._idleChain;
  let calls = 0;
  chain.hold = () => { calls++; };
  chain.pickNext = () => { calls++; };
  d.feed({ type: 'agent.thinking' });
  expect(d.semanticState).toBe('THINKING');
  d.hold(500);
  d.pickNext();
  expect(d.playMsFor('fidget-2')).toBe(null);
  expect(calls).toBe(0);
  d.stop();

  const d2 = new StateDriver({});
  d2.start();
  expect(() => { d2.hold(10); d2.pickNext(); }).not.toThrow();
  expect(d2.playMsFor('idle')).toBe(null);
  d2.stop();
});

test('StateDriver.click：没有 clickAction 时 IDLE 委托概率链的 clicks（保留 CLICK kind）', () => {
  const d = new StateDriver({ chain: IDLE_CHAIN });
  const calls = capture(d);
  d.start();
  d.click();
  expect(calls.at(-1)).toEqual(['fidget-2', { loop: false, kind: 'CLICK', expression: 'smile', voice: 'hello' }]);
  d.stop();
});

test('StateDriver.click：clickAction 优先；非 IDLE 不委托', () => {
  const d = new StateDriver({ chain: IDLE_CHAIN, clickAction: 'poke' });
  const calls = capture(d);
  d.start();
  d.click();
  expect(calls.at(-1)).toEqual(['poke', { loop: false, kind: 'CLICK' }]);
  d.stop();

  const d2 = new StateDriver({ chain: IDLE_CHAIN, stateActions: { THINKING: 'idle' } });
  const calls2 = capture(d2);
  d2.start();
  d2.feed({ type: 'agent.thinking' });
  const n = calls2.length;
  d2.click();
  expect(calls2.length).toBe(n);
  d2.stop();
});
