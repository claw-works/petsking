// core/look.js — 表情 / 手势分层解析（纯函数，无 DOM 依赖）
//
// DeskPet 里有多个来源同时想改表情/手势，各自 save/restore 会互相踩（叠音卡表情、意图到期冲掉状态等）。
// 改为每个来源只维护自己那一层，最终外观由本函数按优先级统一算出：
//
//   表情：talk（说话台词表情）> manual（pet.setExpression 手动）> react（意图表演 holdMs）> state（驱动状态）> 'neutral'
//   手势：manual > react > state > null（说话不碰手势）
//
// 每层形如 { expression?, gesture? } 或 null；值为 null / undefined / '' 视为该层未设置，向下一层回落。

const has = (v) => v != null && v !== '';

function pick(layers, key) {
  for (const l of layers) if (l && has(l[key])) return l[key];
  return undefined;
}

/**
 * @param {{ talk?: object|null, manual?: object|null, react?: object|null, state?: object|null }} layers
 * @returns {{ expression: string, gesture: string|null }}
 */
export function resolveLook({ talk = null, manual = null, react = null, state = null } = {}) {
  return {
    expression: pick([talk, manual, react, state], 'expression') ?? 'neutral',
    gesture: pick([manual, react, state], 'gesture') ?? null,
  };
}
