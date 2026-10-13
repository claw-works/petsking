// pet-lib/renderers/gltf-math.test.js
import { test, expect } from 'bun:test';
import { frameCamera, pxPerMeter, walkSpeedPx, mouthTargets, DEFAULT_MOUTH_MAP } from './gltf-math.js';

test('full：以身高中点为目标，留 12% 余量装下全身', () => {
  const f = frameCamera({ mode: 'full', height: 1.7, fovDeg: 30 });
  expect(f.target).toEqual([0, 0.85, 0]);
  expect(f.position[1]).toBe(0.85);
  expect(f.distance).toBeCloseTo((1.7 * 1.12 / 2) / Math.tan(Math.PI / 12), 5);
  expect(f.position[2]).toBeCloseTo(f.distance, 5);
  expect(f.fov).toBe(30);
});

test('bust：可视高度 0.5 身高，中心在头骨下 0.12 身高', () => {
  const f = frameCamera({ mode: 'bust', height: 1.7, headY: 1.55, fovDeg: 30 });
  expect(f.target[1]).toBeCloseTo(1.55 - 0.204, 5);
  expect(f.distance).toBeCloseTo((0.85 / 2) / Math.tan(Math.PI / 12), 5);
});

test('full：脚不在原点（minY = -0.9）时中心随包围盒下沿平移', () => {
  const f = frameCamera({ mode: 'full', minY: -0.9, height: 1.7, fovDeg: 30 });
  expect(f.target[1]).toBeCloseTo(-0.05, 5);
  expect(f.position[1]).toBeCloseTo(-0.05, 5);
});

test('bust：画面顶沿不低于 headY + 0.1 身高（头顶留余量）', () => {
  const height = 1.7, headY = 1.55, fovDeg = 30;
  const f = frameCamera({ mode: 'bust', height, headY, fovDeg });
  const viewH = 2 * f.distance * Math.tan(Math.PI / 12);
  expect(f.target[1] + viewH / 2).toBeGreaterThanOrEqual(headY + 0.1 * height);
});

test('bust 但找不到头骨 → 回落 full', () => {
  expect(frameCamera({ mode: 'bust', height: 1.7, headY: null, fovDeg: 30 })).toEqual(frameCamera({ mode: 'full', height: 1.7, fovDeg: 30 }));
});

test('pxPerMeter：可视高度对应容器高度', () => {
  const f = frameCamera({ mode: 'full', height: 1.7, fovDeg: 30 });
  expect(pxPerMeter({ fovDeg: 30, distance: f.distance, heightPx: 500 })).toBeCloseTo(500 / (1.7 * 1.12), 5);
});

test('walkSpeedPx：只取屏幕水平分量（sin yaw）× scale', () => {
  const base = { speed: 1, fovDeg: 30, distance: 3, heightPx: 400 };
  const ppm = pxPerMeter(base);
  expect(walkSpeedPx({ ...base, yawDeg: 90 })).toBeCloseTo(ppm, 5);
  expect(walkSpeedPx({ ...base, yawDeg: -70 })).toBeCloseTo(ppm * Math.sin(70 * Math.PI / 180), 5);
  expect(walkSpeedPx({ ...base, yawDeg: 0 })).toBeCloseTo(0, 5);
  expect(walkSpeedPx({ ...base, yawDeg: 90, scale: 0.5 })).toBeCloseTo(ppm / 2, 5);
});

test('mouthTargets：默认映射与旧的硬编码公式一致', () => {
  const f = { open: 0.6, wide: 0.3, round: 0.2 };
  const a = Math.max(0, 1 - f.wide - f.round);
  const t = mouthTargets(f);
  expect(t.Aa).toBeCloseTo(f.open * a * 0.8, 6);
  expect(t.I).toBeCloseTo(f.open * f.wide * 0.75, 6);
  expect(t.E).toBeCloseTo(f.open * f.wide * 0.3, 6);
  expect(t.O).toBeCloseTo(f.open * f.round * 0.8, 6);
  expect(t.U).toBeCloseTo(f.open * f.round * 0.35, 6);
  expect(t.M_OpenSmall).toBeCloseTo(f.open * 0.25, 6);
  expect(Object.keys(t).sort()).toEqual(Object.keys(DEFAULT_MOUTH_MAP).sort());
});

test('mouthTargets：自定义映射可组合多个特征', () => {
  const t = mouthTargets({ open: 0.5, wide: 0.4, round: 0 }, { jawOpen: { open: 1 }, mouthWide: { wide: 1, a: 0.5 } });
  expect(t.jawOpen).toBeCloseTo(0.5, 6);
  expect(t.mouthWide).toBeCloseTo(0.5 * (0.4 + 0.6 * 0.5), 6);
});
