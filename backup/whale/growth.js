// growth.js — whale-on-desk 成长系统复刻（1:1 移植自 lib/growth.mjs）
//
// 零负反馈：永不扣分。完成任务 +XP，开新会话 +XP，活跃时长累积。
// 等级用闭形公式 O(1) 计算，称号是纯谓词，满足即解锁。持久化走 localStorage。

const STORE_KEY = 'pet-study-whale:growth';
const MEMORY_MAX = 40;

// XP ↔ 等级：xpForLevel(L) = 50 * L * (L-1) / 2（源自 growth.mjs 第 14-28 行）
export const xpForLevel = (level) => (50 * level * (level - 1)) / 2;

export function levelForXp(xp) {
  if (xp < 0) return 1;
  return Math.max(1, Math.floor((25 + Math.sqrt(625 + 100 * xp)) / 50));
}

export const xpToNext = (xp) => Math.max(0, xpForLevel(levelForXp(xp) + 1) - xp);

export const levelProgress = (xp) => {
  const level = levelForXp(xp);
  const floorXp = xpForLevel(level);
  const ceilXp = xpForLevel(level + 1);
  return Math.min(1, Math.max(0, (xp - floorXp) / (ceilXp - floorXp)));
};

export const XP_REWARDS = { TASK_DONE: 10, SESSION_NEW: 5 };

// 称号表（源自 growth.mjs 第 36-48 行）
export const TITLES = [
  { id: 'first-task', name: '初次协作', test: (s) => s.tasksDone >= 1 },
  { id: 'helper', name: '勤劳伙伴', test: (s) => s.tasksDone >= 20 },
  { id: 'veteran', name: '百炼成钢', test: (s) => s.tasksDone >= 100 },
  { id: 'regular', name: '常驻伙伴', test: (s) => s.activeMs >= 6 * 3600_000 },
  { id: 'resilient', name: '越挫越勇', test: (s) => s.failures >= 5 },
  { id: 'social', name: '广结善缘', test: (s) => s.sessions >= 10 },
  { id: 'streak-master', name: '连胜大师', test: (s) => s.bestStreak >= 5 },
  { id: 'night-owl', name: '夜猫子', test: (s) => s.nightMs >= 3600_000 },
];

export function freshGrowth() {
  return {
    xp: 0,
    titles: [],
    memory: [],
    stats: { tasksDone: 0, failures: 0, sessions: 0, activeMs: 0, nightMs: 0, bestStreak: 0 },
  };
}

export function loadGrowth() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...freshGrowth(), ...JSON.parse(raw) };
  } catch (e) { /* 破损回退 */ }
  return freshGrowth();
}

export function saveGrowth(g) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(g)); } catch (e) {}
}

/** 应用一个成长事件，返回信号（升级/新称号/记忆条目），供 UI 播报 */
export function applyGrowth(g, event) {
  const signal = { xpGained: 0, leveledUpTo: null, newTitles: [], memory: null };
  const oldLevel = levelForXp(g.xp);

  const addMemory = (text) => {
    const ts = new Date();
    const entry = `[${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}] ${text}`;
    g.memory.push(entry);
    if (g.memory.length > MEMORY_MAX) g.memory.splice(0, g.memory.length - MEMORY_MAX);
    signal.memory = entry;
  };

  switch (event.kind) {
    case 'task-done':
      g.stats.tasksDone += 1;
      g.xp += XP_REWARDS.TASK_DONE;
      signal.xpGained = XP_REWARDS.TASK_DONE;
      addMemory(`完成任务（第 ${g.stats.tasksDone} 个）`);
      break;
    case 'task-failed':
      g.stats.failures += 1; // 只记录，不扣分
      break;
    case 'session-new':
      g.stats.sessions += 1;
      g.xp += XP_REWARDS.SESSION_NEW;
      signal.xpGained = XP_REWARDS.SESSION_NEW;
      addMemory(`开启新会话（第 ${g.stats.sessions} 个）`);
      break;
    case 'active-time':
      g.stats.activeMs += Math.min(event.ms, 5 * 60_000);
      if (event.night) g.stats.nightMs += Math.min(event.ms, 5 * 60_000);
      break;
    case 'streak':
      g.stats.bestStreak = Math.max(g.stats.bestStreak, event.count);
      break;
  }

  const newLevel = levelForXp(g.xp);
  if (newLevel > oldLevel) {
    signal.leveledUpTo = newLevel;
    addMemory(`升到 Lv.${newLevel}`);
  }
  for (const t of TITLES) {
    if (!g.titles.includes(t.id) && t.test(g.stats)) {
      g.titles.push(t.id);
      signal.newTitles.push({ id: t.id, name: t.name });
      addMemory(`解锁称号「${t.name}」`);
    }
  }
  return signal;
}

export function growthView(g) {
  return {
    level: levelForXp(g.xp),
    xp: g.xp,
    toNext: xpToNext(g.xp),
    progress: Math.round(levelProgress(g.xp) * 100) / 100,
    titles: g.titles.map((id) => TITLES.find((t) => t.id === id)?.name).filter(Boolean),
    latestTitle: g.titles.length ? TITLES.find((t) => t.id === g.titles[g.titles.length - 1])?.name : null,
    memory: g.memory.slice(-3),
    stats: { tasks: g.stats.tasksDone, sessions: g.stats.sessions },
  };
}
