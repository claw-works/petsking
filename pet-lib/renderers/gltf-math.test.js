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

// —— fitCamera：按动作包络盒取景，高宽两个方向都留白 ——
import { fitCamera } from './gltf-math.js';

// 包络盒最靠近相机那一面（z = max.z）上的点投影到 NDC
function ndcAtFront(f, box, x, y, aspect) {
  const t = Math.tan((f.fov * Math.PI) / 360);
  const depth = f.position[2] - box.max[2];
  return [(x - f.position[0]) / (depth * t * aspect), (y - f.position[1]) / (depth * t)];
}

test('fitCamera：高瘦包络在宽容器里由高度决定，上下各留 padding', () => {
  const box = { min: [-0.3, 0, -0.2], max: [0.3, 2, 0.2] };
  const f = fitCamera({ box, fovDeg: 30, aspect: 1, padding: 0.1 });
  const [, top] = ndcAtFront(f, box, 0, 2, 1);
  const [, bottom] = ndcAtFront(f, box, 0, 0, 1);
  expect(top).toBeCloseTo(0.9, 6);
  expect(bottom).toBeCloseTo(-0.9, 6);
});

test('fitCamera：宽包络在窄容器里由宽度决定，左右各留 padding，高度也不超', () => {
  const box = { min: [-1, 0, -0.5], max: [1, 2, 0.5] };
  const aspect = 0.6;
  const f = fitCamera({ box, fovDeg: 30, aspect, padding: 0.1 });
  const [l] = ndcAtFront(f, box, -1, 1, aspect);
  const [r] = ndcAtFront(f, box, 1, 1, aspect);
  const [, top] = ndcAtFront(f, box, 0, 2, aspect);
  expect(l).toBeCloseTo(-0.9, 6);
  expect(r).toBeCloseTo(0.9, 6);
  expect(Math.abs(top)).toBeLessThanOrEqual(0.9 + 1e-9);
});

test('fitCamera：不对称包络 → 对准包络中心平视（target 与相机同 x/y）', () => {
  const box = { min: [-1.1, -0.1, -1.1], max: [0.9, 2.1, 0.6] };
  const f = fitCamera({ box, fovDeg: 30, aspect: 0.88, padding: 0.1 });
  expect(f.target[0]).toBeCloseTo(-0.1, 6);
  expect(f.target[1]).toBeCloseTo(1.0, 6);
  expect(f.position[0]).toBe(f.target[0]);
  expect(f.position[1]).toBe(f.target[1]);
  expect(f.target[2]).toBe(0);
  expect(f.distance).toBe(f.position[2]);   // 到角色平面 z=0 的距离（步速换算用）
});

test('fitCamera：padding 越大相机越远', () => {
  const box = { min: [-0.5, 0, -0.3], max: [0.5, 1.8, 0.3] };
  const a = fitCamera({ box, aspect: 0.8, padding: 0.05 });
  const b = fitCamera({ box, aspect: 0.8, padding: 0.2 });
  expect(b.distance).toBeGreaterThan(a.distance);
});

test('fitCamera(points)：按轮廓点精确装框，最外点恰好落在 padding 线上', () => {
  // 两侧伸出的点离相机远近不同：盒子前表面装框会过于保守，按点算则恰好贴线
  const points = [[-1, 1, 0], [1, 1, 0.1], [0, 0, -0.5], [0, 2, 0.2], [0.2, 1.2, 0.9]];
  const box = { min: [-1, 0, -0.5], max: [1, 2, 0.9] };
  const aspect = 0.8, padding = 0.1;
  const f = fitCamera({ box, points, fovDeg: 30, aspect, padding });
  const t = Math.tan(Math.PI / 12);
  let worst = 0;
  for (const [x, y, z] of points) {
    const depth = f.position[2] - z;
    worst = Math.max(worst, Math.abs((x - f.position[0]) / (depth * t * aspect)), Math.abs((y - f.position[1]) / (depth * t)));
  }
  expect(worst).toBeCloseTo(0.9, 6);
  expect(f.distance).toBeLessThan(fitCamera({ box, fovDeg: 30, aspect, padding }).distance);
});
