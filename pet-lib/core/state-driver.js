// state-driver.js — Agent 事件驱动的语义状态机（反映 AI 工作状态）。
//
// 范式：喂归一化事件 → 纯函数分类到语义状态 → 多任务优先级折叠 → 映射到动作。
// 融合 dsh-desktop-pet（确定性 + 多任务折叠 + flash/sleep）与 whale（Agent 语义）。
//
// config：
//   stateActions: { SEMANTIC: actionName }   状态→动作映射（来自素材包）
//   flashMs, sleepAfterMs, thinkingMs         计时
//   idleAction                                默认 idle 动作名
//
// 外部通过 pet.feed(event) → driver.feed(event) 喂事件（见 ai/agent-bridge.js）。
import { DriverBase, registerDriver } from './driver-base.js';

export const SEMANTIC_PRIORITY = {
  WAITING_FOR_USER: 60, ERROR: 50,
  WORKING: 40, CODING: 40, RUNNING_COMMAND: 40,
  THINKING: 30, SUCCESS: 20, STARTING: 10, IDLE: 0, SLEEPING: -10,
};
const FLASH = new Set(['STARTING', 'SUCCESS', 'ERROR']);
const IDLE_PROTECTED = new Set(['STARTING', 'WAITING_FOR_USER', 'SUCCESS', 'ERROR']);

function classifyTool(name) {
  if (/edit|write|patch|update-file|apply|replace/i.test(name)) return 'CODING';
  if (/bash|shell|run|exec|command|terminal|python|node/i.test(name)) return 'RUNNING_COMMAND';
  return 'WORKING';
}

/** 归一化事件 → 语义状态（纯函数） */
export function resolveEvent(ev) {
  switch (ev.type) {
    case 'session.started': return { state: 'STARTING', flash: true };
    case 'session.idle': return { state: 'IDLE' };
    case 'agent.thinking': return { state: 'THINKING' };
    case 'tool.started': return { state: classifyTool(ev.tool || '') };
    case 'tool.completed': return { state: 'IDLE' };
    case 'user_input.required': return { state: 'WAITING_FOR_USER' };
    case 'user_input.resolved': return { state: 'IDLE' };
    case 'task.completed': return { state: 'SUCCESS', flash: true };
    case 'task.failed': return { state: 'ERROR', flash: true };
    default: return null;
  }
}

export class StateDriver extends DriverBase {
  constructor(config) {
    super(config);
    this.stateActions = config.stateActions || {};
    this.idleAction = config.idleAction || 'idle';
    this.flashMs = config.flashMs ?? 2000;
    this.thinkingMs = config.thinkingMs ?? 2000;
    this.sleepAfterMs = config.sleepAfterMs ?? 60_000;
    this.minStateMs = config.minStateMs ?? 250;
    this.clickAction = config.clickAction || null;

    this.tasks = new Map();
    this.state = 'IDLE';
    this.lastChangeAt = 0;
    this.lastActivityAt = Date.now();
    this._timer = null;
  }

  start() { this._emitState('IDLE'); this._timer = setInterval(() => this._recompute(), 200); }
  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  /** 喂归一化 Agent 事件 */
  feed(ev) {
    const r = resolveEvent(ev);
    if (!r) return;
    const id = ev.taskId || 'default';
    const now = Date.now();
    if (r.state === 'IDLE') {
      const t = this.tasks.get(id);
      if (t && IDLE_PROTECTED.has(t.state) && (t.flashUntil || 0) > now) return;
    }
    const t = this.tasks.get(id) || {};
    t.state = r.state;
    if (r.flash) t.flashUntil = now + this.flashMs;
    if (r.state === 'THINKING') t.thinkUntil = now + this.thinkingMs;
    this.tasks.set(id, t);
    this.lastActivityAt = now;
    this._recompute();
  }

  removeTask(id) { this.tasks.delete(id); this._recompute(); }

  _fold() {
    let best = 'IDLE', bp = SEMANTIC_PRIORITY.IDLE, now = Date.now();
    for (const t of this.tasks.values()) {
      let s = t.state;
      if (FLASH.has(s) && (t.flashUntil || 0) <= now) s = 'IDLE';
      if (s === 'THINKING' && (t.thinkUntil || 0) <= now) s = 'IDLE';
      const p = SEMANTIC_PRIORITY[s];
      if (p > bp) { best = s; bp = p; }
    }
    return best;
  }

  _recompute() {
    const now = Date.now();
    let next = this._fold();
    if (next === 'IDLE' && now - this.lastActivityAt >= this.sleepAfterMs) next = 'SLEEPING';
    if (next === this.state) return;
    if (now - this.lastChangeAt < this.minStateMs && SEMANTIC_PRIORITY[next] <= SEMANTIC_PRIORITY[this.state]) return;
    this.state = next; this.lastChangeAt = now;
    this._emitState(next);
  }

  _emitState(state) {
    const action = this.stateActions[state] || this.idleAction;
    // SLEEPING/IDLE 循环；flash/工作态多为一次性但也循环播（webm 循环安全）
    this._emit(action, { loop: true, kind: state });
  }

  click() { if (this.clickAction) this._emit(this.clickAction, { loop: false, kind: 'CLICK' }); }

  get semanticState() { return this.state; }
}

registerDriver('statemachine', StateDriver);
