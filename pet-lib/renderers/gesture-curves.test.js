// pet-lib/renderers/gesture-curves.test.js
import { test, expect } from 'bun:test';
import { GESTURES, FADE, gestureWeight, gestureDone, sampleGesture } from './gesture-curves.js';

test('内置 6 个手势', () => {
  expect(Object.keys(GESTURES).sort()).toEqual(['lean', 'lookDown', 'lookUp', 'nod', 'shake', 'tilt']);
});

test('权重：t=0 为 0，FADE 后为 1', () => {
  expect(gestureWeight(GESTURES.tilt, 0)).toBe(0);
  expect(gestureWeight(GESTURES.tilt, FADE)).toBe(1);
  expect(gestureWeight(GESTURES.tilt, 100)).toBe(1);
});

test('一次型在 dur 前 FADE 秒开始淡出，dur 时归零并结束', () => {
  const g = GESTURES.nod;
  expect(gestureWeight(g, g.dur - FADE / 2)).toBeCloseTo(0.5, 5);
  expect(gestureWeight(g, g.dur)).toBe(0);
  expect(gestureDone(g, g.dur - 0.01, null)).toBe(false);
  expect(gestureDone(g, g.dur, null)).toBe(true);
});

test('持续型不会自己结束；release 后 FADE 秒淡出结束', () => {
  const g = GESTURES.lookDown;
  expect(gestureDone(g, 999, null)).toBe(false);
  expect(gestureWeight(g, 5, 4.9)).toBeCloseTo(1 - 0.1 / FADE, 5);
  expect(gestureDone(g, 4 + FADE + 0.01, 4)).toBe(true);
});

test('sampleGesture：lookDown 低头为正 x，已乘权重；未知手势 null', () => {
  const s = sampleGesture('lookDown', 1, null);
  expect(s.head.x).toBeGreaterThan(0.2);
  expect(s.spine).toEqual({ x: 0, y: 0, z: 0 });
  expect(sampleGesture('lookDown', 0, null).head.x).toBe(0);
  expect(sampleGesture('nope', 1, null)).toBe(null);
});

test('nod 中途有低头分量', () => {
  const s = sampleGesture('nod', GESTURES.nod.dur / 4, null);
  expect(s.head.x).toBeGreaterThan(0.1);
});
