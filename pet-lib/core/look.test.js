// pet-lib/core/look.test.js
import { test, expect } from 'bun:test';
import { resolveLook } from './look.js';

test('全空 → neutral / 无手势', () => {
  expect(resolveLook()).toEqual({ expression: 'neutral', gesture: null });
  expect(resolveLook({ talk: null, manual: null, react: null, state: null })).toEqual({ expression: 'neutral', gesture: null });
});

test('表情优先级：说话 > 手动 > 意图 > 状态', () => {
  const state = { expression: 'sleepy' };
  const react = { expression: 'happy' };
  const manual = { expression: 'shy' };
  const talk = { expression: 'surprised' };
  expect(resolveLook({ state }).expression).toBe('sleepy');
  expect(resolveLook({ state, react }).expression).toBe('happy');
  expect(resolveLook({ state, react, manual }).expression).toBe('shy');
  expect(resolveLook({ state, react, manual, talk }).expression).toBe('surprised');
});

test('手势优先级：手动 > 意图 > 状态', () => {
  expect(resolveLook({ state: { gesture: 'nod' } }).gesture).toBe('nod');
  expect(resolveLook({ state: { gesture: 'nod' }, react: { gesture: 'tilt' } }).gesture).toBe('tilt');
  expect(resolveLook({ state: { gesture: 'nod' }, react: { gesture: 'tilt' }, manual: { gesture: 'shake' } }).gesture).toBe('shake');
});

test('说话层不影响手势', () => {
  const r = resolveLook({ talk: { expression: 'happy', gesture: 'shake' }, state: { gesture: 'nod' } });
  expect(r).toEqual({ expression: 'happy', gesture: 'nod' });
});

test('上层只设了表情时手势回落下层（反之亦然）', () => {
  const r = resolveLook({ react: { expression: 'happy' }, state: { expression: 'sleepy', gesture: 'nod' } });
  expect(r).toEqual({ expression: 'happy', gesture: 'nod' });
  const r2 = resolveLook({ react: { gesture: 'tilt' }, state: { expression: 'sleepy' } });
  expect(r2).toEqual({ expression: 'sleepy', gesture: 'tilt' });
});

test('null / undefined / 空串视为未设置', () => {
  const r = resolveLook({ talk: { expression: null }, manual: { expression: '', gesture: undefined }, react: { expression: undefined, gesture: null }, state: { expression: 'sad', gesture: 'nod' } });
  expect(r).toEqual({ expression: 'sad', gesture: 'nod' });
});
