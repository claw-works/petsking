// pet-lib/core/performance.js — 「表演」解析
//
// 素材包里 stateActions / intentMap / chain.clicks 的值可以是：
//   "wave"                                              只播动作（旧格式）
//   { action, expression, gesture, voice, say, holdMs } 动作 + 表情 + 头部手势 + 预录语音 + 气泡
// 解析成统一对象交给 DeskPet 分发；渲染器不支持的部分会被忽略。

const EXTRA_KEYS = ['expression', 'gesture', 'voice', 'say'];

export function resolvePerformance(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return { action: value };
  if (typeof value !== 'object') return null;
  const out = { action: value.action || null };
  for (const k of EXTRA_KEYS) if (value[k]) out[k] = value[k];
  if (value.holdMs != null) out.holdMs = value.holdMs;
  if (!out.action && !EXTRA_KEYS.some((k) => out[k])) return null;
  return out;
}

/** 表演里除 action 以外的字段，并入驱动 onAction 的 meta */
export function performanceMeta(perf) {
  if (!perf) return {};
  const { action, ...rest } = perf;
  return rest;
}
