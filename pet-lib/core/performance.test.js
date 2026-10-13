// pet-lib/core/performance.test.js
import { test, expect } from 'bun:test';
import { resolvePerformance, performanceMeta } from './performance.js';

test('字符串 = 只有动作（旧格式兼容）', () => {
  expect(resolvePerformance('wave')).toEqual({ action: 'wave' });
});

test('对象：保留 action/expression/gesture/voice/say/holdMs', () => {
  const p = resolvePerformance({ action: 'idle', expression: 'sad', gesture: 'lookDown', voice: 'error', say: '哎', holdMs: 1500, junk: 1 });
  expect(p).toEqual({ action: 'idle', expression: 'sad', gesture: 'lookDown', voice: 'error', say: '哎', holdMs: 1500 });
});

test('对象可以没有 action（只换表情）', () => {
  expect(resolvePerformance({ expression: 'smile' })).toEqual({ action: null, expression: 'smile' });
});

test('空值 / 空对象 / 非法类型 → null', () => {
  expect(resolvePerformance(null)).toBe(null);
  expect(resolvePerformance(undefined)).toBe(null);
  expect(resolvePerformance('')).toBe(null);
  expect(resolvePerformance({})).toBe(null);
  expect(resolvePerformance(42)).toBe(null);
});

test('performanceMeta 去掉 action，其余并入驱动 meta', () => {
  expect(performanceMeta({ action: 'idle', expression: 'sad', voice: 'error' })).toEqual({ expression: 'sad', voice: 'error' });
  expect(performanceMeta(null)).toEqual({});
});
