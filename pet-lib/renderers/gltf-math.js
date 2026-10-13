// pet-lib/renderers/gltf-math.js — 相机取景、步速换算、音频口型映射（纯函数，不依赖 three）
//
// 角色面朝 +Z（朝向相机），相机在 +Z 方向平视。单位：米 / 度 / 像素。
// 不假设模型原点在脚底：由包围盒下沿 minY 与高度 height 推算取景中心。

const rad = (deg) => (deg * Math.PI) / 180;

/**
 * 取景。mode: 'full' 全身 | 'bust' 半身（需 headY）。
 * minY 包围盒下沿；height 包围盒高度（maxY - minY）；headY 头骨世界 Y。
 * 半身：可视高度 = 0.5 身高，中心在头骨下 0.12 身高处，画面顶 ≈ headY + 0.13 身高（头发不被裁）。
 * 返回 { position:[x,y,z], target:[x,y,z], fov, distance }
 */
export function frameCamera({ mode = 'full', minY = 0, height, headY = null, fovDeg = 30 }) {
  let viewH, centerY;
  if (mode === 'bust' && headY != null) {
    viewH = height * 0.5;
    centerY = headY - height * 0.12;
  } else {
    viewH = height * 1.12;
    centerY = minY + height * 0.5;
  }
  const distance = (viewH / 2) / Math.tan(rad(fovDeg) / 2);
  return { position: [0, centerY, distance], target: [0, centerY, 0], fov: fovDeg, distance };
}

/**
 * 按动作包络盒取景（全身）：包络盒 = 所有动作 / 朝向下模型顶点的并集（世界坐标，角色面朝 +Z）。
 * 高、宽两个方向都装下，四周各留 padding（占可视半幅的比例，0.1 = 每边留 10%）。
 * 相机对准包络中心平视。aspect = 容器宽 / 高（容器尺寸变了要重新算）。
 *   points（可选）：采样得到的轮廓点 [[x,y,z], …]。给了就逐点求「恰好落在 padding 线上」的相机距离取最大，
 *                   精确且不保守；
 *   只有 box：以盒子最靠近相机的一面（max.z）装框，透视下更远的部分只会更小，不会被裁（偏保守、留白偏多）。
 * 返回 { position, target, fov, distance }，distance = 相机到角色平面 z=0 的距离（步速换算用）。
 */
export function fitCamera({ box, points = null, fovDeg = 30, aspect = 1, padding = 0.1 }) {
  const [x0, y0] = box.min, [x1, y1, z1] = box.max;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const fill = 1 - padding;
  const t = Math.tan(rad(fovDeg) / 2);
  const kx = 1 / (fill * t * aspect), ky = 1 / (fill * t);
  let camZ;
  if (points && points.length) {
    // 点 (x,y,z) 的 ndc_x = (x-cx) / ((camZ-z)·t·aspect)，要 |ndc| ≤ fill ⇒ camZ ≥ z + |x-cx|·kx（y 同理）
    camZ = -Infinity;
    for (const [x, y, z] of points) camZ = Math.max(camZ, z + Math.abs(x - cx) * kx, z + Math.abs(y - cy) * ky);
  } else {
    camZ = z1 + Math.max(((y1 - y0) / 2) * ky, ((x1 - x0) / 2) * kx);
  }
  return { position: [cx, cy, camZ], target: [cx, cy, 0], fov: fovDeg, distance: camZ };
}

/** 角色所在深度处，每米对应多少屏幕像素 */
export function pxPerMeter({ fovDeg, distance, heightPx }) {
  return heightPx / (2 * distance * Math.tan(rad(fovDeg) / 2));
}

/** 走路 clip 的真实速度（m/s）→ 容器水平平移速度（px/s）。斜着走只取水平分量。 */
export function walkSpeedPx({ speed, yawDeg, fovDeg, distance, heightPx, scale = 1 }) {
  return speed * Math.abs(Math.sin(rad(yawDeg))) * pxPerMeter({ fovDeg, distance, heightPx }) * scale;
}

// 音频口型特征 → morph 的默认映射（清霄的 Aa/I/E/O/U/M_OpenSmall）。
// 格式：{ morph: { 特征: 系数 } }，morph 权重 = open × Σ(特征值 × 系数)；
// 特征：a（张嘴非扁非圆 = max(0, 1 - wide - round)）、wide、round、open（恒为 1，即只随张嘴幅度）。
export const DEFAULT_MOUTH_MAP = {
  Aa: { a: 0.8 },
  I: { wide: 0.75 },
  E: { wide: 0.3 },
  O: { round: 0.8 },
  U: { round: 0.35 },
  M_OpenSmall: { open: 0.25 },
};

/** 音频口型帧 { open, wide, round } 按 mouthMap 换算成 morph 目标值（纯函数） */
export function mouthTargets(frame, mouthMap = DEFAULT_MOUTH_MAP) {
  const o = frame.open || 0;
  const feat = { a: Math.max(0, 1 - (frame.wide || 0) - (frame.round || 0)), wide: frame.wide || 0, round: frame.round || 0, open: 1 };
  const out = {};
  for (const [morph, w] of Object.entries(mouthMap)) {
    let v = 0;
    for (const [k, c] of Object.entries(w || {})) v += (feat[k] || 0) * c;
    out[morph] = o * v;
  }
  return out;
}
