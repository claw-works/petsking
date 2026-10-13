// pet-lib/renderers/gesture-curves.js — 程序化头部 / 上身小动作的曲线（纯函数，不依赖 three）
//
// 坐标系是角色自身（面朝 +Z、Y 向上、X 指向角色左手边），单位弧度：
//   x 俯仰（正 = 低头）  y 偏航（正 = 脸转向角色左边）  z 侧倾（正 = 头歪向角色右肩）
// 每个手势：fn(p, t) → { head?, neck?, spine? }，p = 一次型的进度 0..1，t = 开始后的秒数。
// 一次型（once）播完 dur 自动结束；持续型一直保持，直到被替换 / 清除（release）后淡出。
// 若实测方向反了，只改这里的符号。

export const FADE = 0.3;

const S = Math.sin;
export const GESTURES = {
  nod:      { once: true, dur: 1.0, fn: (p) => ({ head: { x: 0.22 * S(p * Math.PI * 2) ** 2 }, neck: { x: 0.06 * S(p * Math.PI * 2) ** 2 } }) },
  shake:    { once: true, dur: 1.2, fn: (p) => ({ head: { y: 0.25 * S(p * Math.PI * 4) * (1 - p) } }) },
  tilt:     { fn: (p, t) => ({ head: { z: 0.18 + 0.02 * S(t * 1.2), x: -0.05 } }) },
  lookUp:   { fn: (p, t) => ({ head: { x: -0.25 + 0.015 * S(t * 0.9) }, neck: { x: -0.08 } }) },
  lookDown: { fn: () => ({ head: { x: 0.3 }, neck: { x: 0.1 } }) },
  lean:     { fn: () => ({ spine: { x: 0.12 }, head: { x: -0.08 } }) },
};

export function gestureWeight(g, t, releasedAt = null) {
  let w = Math.min(1, t / FADE);
  if (g.once) w = Math.min(w, Math.max(0, (g.dur - t) / FADE));
  if (releasedAt != null) w = Math.min(w, Math.max(0, 1 - (t - releasedAt) / FADE));
  w = Math.min(1, Math.max(0, w));
  // smoothstep：淡入淡出两端速度为 0，消除线性权重的速度拐点
  return w * w * (3 - 2 * w);
}

export function gestureDone(g, t, releasedAt = null) {
  if (releasedAt != null && t - releasedAt >= FADE) return true;
  return !!g.once && t >= g.dur;
}

const ZERO = () => ({ x: 0, y: 0, z: 0 });

/** 采样一个手势在 t 时刻的骨骼偏移（已乘权重）。未知手势 → null */
export function sampleGesture(name, t, releasedAt = null) {
  const g = GESTURES[name];
  if (!g) return null;
  const w = gestureWeight(g, t, releasedAt);
  const raw = g.fn(g.once ? Math.min(1, t / g.dur) : 0, t);
  const out = { head: ZERO(), neck: ZERO(), spine: ZERO() };
  for (const part of ['head', 'neck', 'spine']) {
    const r = raw[part];
    if (!r) continue;
    out[part] = { x: (r.x || 0) * w, y: (r.y || 0) * w, z: (r.z || 0) * w };
  }
  return out;
}
