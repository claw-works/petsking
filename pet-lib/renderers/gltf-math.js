// pet-lib/renderers/gltf-math.js — 相机取景与步速换算（纯函数，不依赖 three）
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

/** 角色所在深度处，每米对应多少屏幕像素 */
export function pxPerMeter({ fovDeg, distance, heightPx }) {
  return heightPx / (2 * distance * Math.tan(rad(fovDeg) / 2));
}

/** 走路 clip 的真实速度（m/s）→ 容器水平平移速度（px/s）。斜着走只取水平分量。 */
export function walkSpeedPx({ speed, yawDeg, fovDeg, distance, heightPx, scale = 1 }) {
  return speed * Math.abs(Math.sin(rad(yawDeg))) * pxPerMeter({ fovDeg, distance, heightPx }) * scale;
}
