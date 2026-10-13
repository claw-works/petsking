// pet-lib/voice/visemes.test.js
import { test, expect } from 'bun:test';
import { VISEMES, charToViseme, textToVisemeTimeline, visemeAt } from './visemes.js';

test('拉丁字母映射', () => {
  expect(charToViseme('a')).toBe('A');
  expect(charToViseme('O')).toBe('O');
  expect(charToViseme('m')).toBe('M');
  expect(charToViseme('s')).toBe('S');
  expect(charToViseme(' ')).toBe('rest');
});

test('汉字映射到元音口型且确定（同字同口型）', () => {
  const v = charToViseme('好');
  expect(['A', 'E', 'I', 'O', 'U']).toContain(v);
  expect(charToViseme('好')).toBe(v);
});

test('标点 = rest', () => {
  expect(charToViseme('，')).toBe('rest');
  expect(charToViseme('。')).toBe('rest');
  expect(charToViseme('…')).toBe('rest');
});

test('每个 viseme 名都在表里', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz 你好，') expect(VISEMES[charToViseme(ch)]).toBeDefined();
});

test('时间线：每字一段 + 收尾 rest，时长可预期', () => {
  const tl = textToVisemeTimeline('你好', () => 0); // 固定随机 → 每字 75ms
  expect(tl.events.length).toBe(3);
  expect(tl.events[0]).toEqual({ t: 0, viseme: charToViseme('你'), dur: 0.075 });
  expect(tl.events[2].viseme).toBe('rest');
  expect(tl.duration).toBeCloseTo(0.15 + 0.35, 5);
});

test('空文本 → 空时间线', () => {
  expect(textToVisemeTimeline('')).toEqual({ events: [], duration: 0 });
});

test('visemeAt 取当前时刻口型，越界 rest', () => {
  const tl = textToVisemeTimeline('ab', () => 0);
  expect(visemeAt(tl, 0.01)).toBe('A');
  expect(visemeAt(tl, 0.1)).toBe('M');
  expect(visemeAt(tl, 9)).toBe('rest');
});
