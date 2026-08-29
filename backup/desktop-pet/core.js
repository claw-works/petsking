// core.js — dsh-desktop-pet 核心状态机复刻
//
// 移植自 src/core/{types.ts, PetStateResolver.ts, TaskStateRegistry.ts, PetStateMachine.ts}。
//
// 范式：确定性语义状态机。与 whale 不同，这里强调
//   1) 事件 → 状态是「纯函数分类」，无随机、无副作用
//   2) 多 Agent/任务并发时，按数字优先级「折叠」成一个全局状态
//   3) flash 态（SUCCESS/ERROR/STARTING）定时回落，长静默自动 SLEEPING
//
// 10 个 SemanticState → 4 个动画姿势（webm）。姿势少、状态多，是它和 whale 的关键差异。

// —— SemanticState（源自 types.ts 第 5-13 行）——
export const STATES = [
  'STARTING', 'IDLE', 'THINKING', 'WORKING', 'CODING',
  'RUNNING_COMMAND', 'WAITING_FOR_USER', 'SUCCESS', 'ERROR', 'SLEEPING',
];

// 优先级折叠表（源自 TaskStateRegistry.ts 第 7-17 行）
export const STATE_PRIORITY = {
  WAITING_FOR_USER: 60, // 阻塞在审批：压过一切
  ERROR: 50,
  WORKING: 40, CODING: 40, RUNNING_COMMAND: 40,
  THINKING: 30,
  SUCCESS: 20,
  STARTING: 10,
  IDLE: 0,
  SLEEPING: -10,
};

// 语义状态 → 动画姿势（源自 types.ts 第 57-67 行）。多状态复用同一姿势。
export const SEMANTIC_TO_POSE = {
  STARTING: 'waving',
  IDLE: 'idle',
  THINKING: 'running',
  WORKING: 'running',
  CODING: 'running',
  RUNNING_COMMAND: 'running',
  WAITING_FOR_USER: 'waiting',
  SUCCESS: 'review',
  ERROR: 'failed',
  SLEEPING: 'idle',
};

// flash 态：定时回 IDLE（源自 PetStateMachine.ts）
const FLASH_STATES = new Set(['STARTING', 'SUCCESS', 'ERROR']);
// idle 事件不能覆盖的保护态（源自 IDLE_PROTECTED_STATES 第 36-41 行）
const IDLE_PROTECTED = new Set(['STARTING', 'WAITING_FOR_USER', 'SUCCESS', 'ERROR']);

// —— 工具名分类（源自 PetStateResolver.ts classifyTool 第 16-22 行）——
function classifyTool(toolName) {
  if (/edit|write|patch|update-file|apply|replace/i.test(toolName)) return 'CODING';
  if (/bash|shell|run|exec|command|terminal|python|node/i.test(toolName)) return 'RUNNING_COMMAND';
  return 'WORKING';
}

/** 纯函数：归一化事件 → 语义状态 + 是否 flash（源自 resolveEvent 第 29-55 行） */
export function resolveEvent(ev) {
  switch (ev.type) {
    case 'session.started': return { state: 'STARTING', flash: true };
    case 'session.idle': return { state: 'IDLE', flash: false };
    case 'agent.thinking': return { state: 'THINKING', flash: false };
    case 'tool.started': return { state: classifyTool(ev.tool || ''), flash: false };
    case 'tool.completed': return { state: 'IDLE', flash: false };
    case 'user_input.required': return { state: 'WAITING_FOR_USER', flash: false };
    case 'user_input.resolved': return { state: 'IDLE', flash: false };
    case 'task.completed': return { state: 'SUCCESS', flash: true };
    case 'task.failed': return { state: 'ERROR', flash: true };
    default: return null;
  }
}

/**
 * PetStateMachine：每个 taskId 维护一份状态，全局取最高优先级。
 * onChange(state) 在「折叠后的全局语义状态」变化时回调。
 */
export class PetStateMachine {
  constructor(onChange, opts = {}) {
    this.onChange = onChange || (() => {});
    this.flashMs = opts.flashMs ?? 2000;
    this.thinkingMs = opts.thinkingMs ?? 2000;
    this.sleepAfterMs = opts.sleepAfterMs ?? 60_000;
    this.minStateMs = opts.minStateMs ?? 250;

    this.tasks = new Map(); // taskId -> { state, flashUntil, thinkUntil }
    this.current = 'IDLE';
    this.lastChangeAt = 0;
    this.lastActivityAt = Date.now();

    this._timer = setInterval(() => this._tick(), 200);
  }

  dispose() { clearInterval(this._timer); }

  /** 喂入一个归一化事件 */
  handle(ev) {
    const resolved = resolveEvent(ev);
    if (!resolved) return;
    const taskId = ev.taskId || 'default';
    const now = Date.now();

    // idle 事件不覆盖保护态（防止 turn 末尾的 idle ping 打断 flash）
    if (resolved.state === 'IDLE') {
      const t = this.tasks.get(taskId);
      if (t && IDLE_PROTECTED.has(t.state) && (t.flashUntil || 0) > now) return;
    }

    const task = this.tasks.get(taskId) || {};
    task.state = resolved.state;
    if (resolved.flash) task.flashUntil = now + this.flashMs;
    if (resolved.state === 'THINKING') task.thinkUntil = now + this.thinkingMs;
    this.tasks.set(taskId, task);
    this.lastActivityAt = now;
    this._recompute();
  }

  removeTask(taskId) {
    this.tasks.delete(taskId);
    this._recompute();
  }

  /** 折叠：取所有任务里优先级最高的状态（源自 targetState 第 161-174 行） */
  _fold() {
    let best = 'IDLE';
    let bestP = STATE_PRIORITY.IDLE;
    const now = Date.now();
    for (const task of this.tasks.values()) {
      let s = task.state;
      // flash 到期回 IDLE
      if (FLASH_STATES.has(s) && (task.flashUntil || 0) <= now) s = 'IDLE';
      // thinking 到期回 IDLE
      if (s === 'THINKING' && (task.thinkUntil || 0) <= now) s = 'IDLE';
      const p = STATE_PRIORITY[s];
      if (p > bestP) { best = s; bestP = p; }
    }
    return best;
  }

  _recompute() {
    const now = Date.now();
    let next = this._fold();

    // 长静默 → SLEEPING（仅当折叠结果是 IDLE）
    if (next === 'IDLE' && now - this.lastActivityAt >= this.sleepAfterMs) {
      next = 'SLEEPING';
    }

    if (next === this.current) return;
    // 最小保持时长：低优先级不能立刻打断（除非是更高优先级）
    if (now - this.lastChangeAt < this.minStateMs &&
        STATE_PRIORITY[next] <= STATE_PRIORITY[this.current]) {
      return;
    }
    this.current = next;
    this.lastChangeAt = now;
    this.onChange(next);
  }

  _tick() {
    // 定时驱动 flash 回落、sleep 进入
    this._recompute();
  }

  get pose() { return SEMANTIC_TO_POSE[this.current]; }
  snapshot() { return { state: this.current, pose: this.pose, tasks: [...this.tasks.entries()] }; }
}
