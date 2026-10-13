// pet-lib/voice/mouth-features.test.js
import { test, expect } from 'bun:test';
import { mouthFeatures } from './mouth-features.js';

const SR = 48000, FFT = 1024, BINS = FFT / 2;
const hz = SR / FFT;
const freqWith = (lo, hi, db = 0, rest = -120) => {
  const f = new Float32Array(BINS).fill(rest);
  for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz); i++) f[i] = db;
  return f;
};
const sine = (amp) => Float32Array.from({ length: FFT }, (_, i) => amp * Math.sin(i / 5));

test('静音 → 闭嘴', () => {
  const r = mouthFeatures(new Float32Array(FFT), new Float32Array(BINS).fill(-Infinity), SR, FFT, { peak: 0.05 });
  expect(r).toEqual({ open: 0, wide: 0, round: 0 });
});

test('响亮信号 → 张嘴（自适应峰值跟随）', () => {
  const state = { peak: 0.05 };
  const r = mouthFeatures(sine(0.5), freqWith(200, 800), SR, FFT, state);
  expect(r.open).toBeCloseTo(1, 5);
  expect(state.peak).toBeGreaterThan(0.3);
});

test('能量集中在 1.5–3.5kHz → wide（i/e），不 round', () => {
  const r = mouthFeatures(sine(0.5), freqWith(1500, 3500), SR, FFT, { peak: 0.05 });
  expect(r.wide).toBe(1);
  expect(r.round).toBe(0);
});

test('能量集中在 200–800Hz → round（o/u）', () => {
  const r = mouthFeatures(sine(0.5), freqWith(200, 800), SR, FFT, { peak: 0.05 });
  expect(r.round).toBeGreaterThan(0.8); // 频带边界 bin 有重叠，低频占比 ~0.88
  expect(r.wide).toBe(0);
});
