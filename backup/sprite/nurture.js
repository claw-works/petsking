// nurture.js — dsh-pet-sprite 养成系统复刻
//
// 移植自 attribute-engine.ts / level-system.ts / mini-engine.ts / reward-table.ts。
//
// 三属性 mood/power/health 带衰减与联动；等级二次曲线 Lv1-100；
// 用户输入 token 掉 power，助手输出转 XP。持久化 localStorage。

const STORE_KEY = 'pet-study-sprite:nurture';

// —— 属性预设（源自 presets.ts）——
const ATTR_DEFS = {
  mood: { min: 0, max: 100, init: 80, decayPerMin: 0.06,
    levels: [['sad', 0], ['normal', 30], ['happy', 52], ['joyful', 78]] },
  power: { min: 0, max: 300, init: 210, decayPerMin: 0.18,
    levels: [['starving', 0], ['hungry', 30], ['normal', 105], ['full', 225]] },
  health: { min: 0, max: 100, init: 100, decayPerMin: 0,
    levels: [['sick', 0], ['subhealthy', 35], ['healthy', 70]] },
};

// 等级分阶（源自 LEVEL_TIERS）：[名称, 上限等级, 衰减系数]
const LEVEL_TIERS = [
  ['小萌新', 5, 1.0], ['小帮手', 10, 1.0], ['好伙伴', 15, 0.85],
  ['老搭档', 20, 0.75], ['灵魂伴侣', 25, 0.7], ['传说之伴', 100, 0.6],
];

// 经验曲线：cumExp(L) = 2500 * (L-1)^2（源自 level-system.ts）
const cumExp = (level) => 2500 * (level - 1) ** 2;
function levelForExp(exp) {
  let lv = 1;
  while (lv < 100 && cumExp(lv + 1) <= exp) lv += 1;
  return lv;
}

function levelOf(key, value) {
  const def = ATTR_DEFS[key];
  let name = def.levels[0][0];
  for (const [n, threshold] of def.levels) if (value >= threshold) name = n;
  return name;
}

export function freshState() {
  return {
    mood: ATTR_DEFS.mood.init,
    power: ATTR_DEFS.power.init,
    health: ATTR_DEFS.health.init,
    exp: 0,
    coins: 0,
    lastTick: Date.now(),
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch (e) {}
  return freshState();
}
export function save(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
}

function clamp(key, v) {
  const def = ATTR_DEFS[key];
  return Math.max(def.min, Math.min(def.max, v));
}

export class Nurture {
  constructor(state) {
    this.s = state || load();
  }

  get level() { return levelForExp(this.s.exp); }
  get tier() {
    const lv = this.level;
    for (const [name, cap, mult] of LEVEL_TIERS) if (lv <= cap) return { name, mult };
    return { name: '传说之伴', mult: 0.6 };
  }
  get expToNext() { return Math.max(0, cumExp(this.level + 1) - this.s.exp); }
  get expProgress() {
    const lv = this.level;
    const floor = cumExp(lv), ceil = cumExp(lv + 1);
    return ceil > floor ? Math.min(1, (this.s.exp - floor) / (ceil - floor)) : 1;
  }

  levels() {
    return {
      mood: levelOf('mood', this.s.mood),
      power: levelOf('power', this.s.power),
      health: levelOf('health', this.s.health),
    };
  }

  /** 每 tick 衰减 + 联动（源自 attribute-engine.ts tick 第 96-150 行） */
  tick(now = Date.now()) {
    const dtMin = (now - this.s.lastTick) / 60_000;
    if (dtMin <= 0) return;
    this.s.lastTick = now;
    const mult = this.tier.mult; // 等级越高衰减越慢

    // 基础衰减
    this.s.mood = clamp('mood', this.s.mood - ATTR_DEFS.mood.decayPerMin * dtMin * mult);
    this.s.power = clamp('power', this.s.power - ATTR_DEFS.power.decayPerMin * dtMin * mult);

    // 联动：power/mood 级别 → health 增减（每 30s 一次的效应，换算成 per-min）
    const lv = this.levels();
    let hDelta = 0;
    if (lv.power === 'starving') hDelta -= 0.5;
    else if (lv.power === 'hungry') hDelta -= 0.2;
    else if (lv.power === 'full') hDelta += 0.15;
    if (lv.mood === 'sad') hDelta -= 0.2;
    else if (lv.mood === 'joyful') hDelta += 0.15;
    this.s.health = clamp('health', this.s.health + hDelta * (dtMin * 2)); // ×2：per-30s → per-min
  }

  /** 用户发消息：估算 token，掉 power（源自 mini-engine.ts 第 100-113 行） */
  onUserMessage(text) {
    const estTokens = Math.max(1, Math.round((text || '').length / 4));
    this.s.power = clamp('power', this.s.power - Math.round(estTokens * 0.5));
    return estTokens;
  }

  /** 助手回复完成：长度转 XP */
  onAssistantDone(textLen) {
    const exp = Math.max(1, Math.round(textLen / 4));
    return this.gainExp(exp);
  }

  gainExp(exp) {
    const before = this.level;
    this.s.exp += exp;
    const after = this.level;
    return { exp, leveledUp: after > before ? after : null };
  }

  /** 照顾行动：feed/play/rest，应用属性效果 + 给 XP（源自 care-system.ts） */
  care(action) {
    const effects = {
      feed: { power: +60, mood: +5 },
      play: { mood: +18, power: -18 },
      rest: { mood: +10, health: +8, power: -6 },
      treat: { mood: +25, power: +15 },
    }[action] || {};
    let mag = 0;
    for (const k in effects) { this.s[k] = clamp(k, this.s[k] + effects[k]); mag += Math.abs(effects[k]); }
    const exp = Math.max(100, Math.round(mag * 5));
    return this.gainExp(exp);
  }

  view() {
    return {
      level: this.level, tierName: this.tier.name,
      exp: this.s.exp, expToNext: this.expToNext, expProgress: this.expProgress,
      mood: Math.round(this.s.mood), power: Math.round(this.s.power), health: Math.round(this.s.health),
      levels: this.levels(),
    };
  }
}
