// state-driver.js — Agent 事件驱动的语义状态机（反映 AI 工作状态）。
//
// 范式：喂归一化事件 → 纯函数分类到语义状态 → 多任务优先级折叠 → 映射到动作。
// 融合 dsh-desktop-pet（确定性 + 多任务折叠 + flash/sleep）与 whale（Agent 语义）。
//
// config：
//   stateActions: { SEMANTIC: actionName | 表演对象 }   状态→动作映射（来自素材包，见 performance.js）
//   flashMs, sleepAfterMs                     计时
//   idleAction                                默认 idle 动作名
//
// 外部通过 pet.feed(event) → driver.feed(event) 喂事件（见 ai/agent-bridge.js）。
import { DriverBase, registerDriver, createDriver } from './driver-base.js';
import { resolvePerformance, performanceMeta } from './performance.js';

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
    case 'agent.thinking.done': return { state: 'IDLE' };
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
    this.sleepAfterMs = config.sleepAfterMs ?? 60_000;
    this.minStateMs = config.minStateMs ?? 250;
    this.clickAction = config.clickAction || null;

    this.tasks = new Map();
    this.state = 'IDLE';
    this.lastChangeAt = 0;
    this.lastActivityAt = Date.now();
    this._timer = null;
    // IDLE 时委托给概率链做自主陪伴（若提供了 chain 池配置）
    this._chainConfig = config.chain || null;
    this._idleChain = null;
  }

  /** 惰性创建内部概率链，其动作转发给本驱动的 onAction */
  _ensureIdleChain() {
    if (this._idleChain || !this._chainConfig) return;
    try {
      this._idleChain = createDriver('chain', { ...this._chainConfig });
      this._idleChain.onAction((action, meta) => {
        // 只有仍处于 IDLE 时才转发链的动作（防止竞态）；点击表演保留 CLICK（DeskPet 按它走意图层 / 不占语音冷却）
        if (this.state === 'IDLE') this._emit(action, { ...meta, kind: meta.kind === 'CLICK' ? 'CLICK' : 'IDLE' });
      });
    } catch (e) { this._idleChain = null; }
  }

  _startIdleChain() {
    this._ensureIdleChain();
    if (this._idleChain) this._idleChain.start();
  }
  _stopIdleChain() {
    if (this._idleChain) this._idleChain.stop();
  }

  start() { this._emitState('IDLE'); this._timer = setInterval(() => this._recompute(), 200); }
  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; this._stopIdleChain(); }

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
      const p = SEMANTIC_PRIORITY[s];
      if (p > bp) { best = s; bp = p; }
    }
    return best;
  }

  _recompute() {
    const now = Date.now();
    let next = this._fold();
    // 有概率链接管 IDLE 时，不再自动转 SLEEPING（打盹已在概率链 idle 池里，由链随机触发）
    if (next === 'IDLE' && !this._chainConfig && now - this.lastActivityAt >= this.sleepAfterMs) next = 'SLEEPING';
    if (next === this.state) return;
    if (now - this.lastChangeAt < this.minStateMs && SEMANTIC_PRIORITY[next] <= SEMANTIC_PRIORITY[this.state]) return;
    this.state = next; this.lastChangeAt = now;
    this._emitState(next);
  }

  _emitState(state) {
    if (state === 'IDLE' && this._chainConfig) {
      // IDLE 且有概率链配置 → 委托概率链做自主陪伴（走动/转身/思考/打盹）
      this._startIdleChain();
      return;
    }
    // 离开 IDLE（进入工作/睡眠等状态）→ 停掉自主陪伴，按状态播动作
    this._stopIdleChain();
    // stateActions 的值可以是动作名或表演对象 { action, expression, gesture, voice }
    const perf = resolvePerformance(this.stateActions[state]) || { action: this.idleAction };
    this._emit(perf.action || this.idleAction, { loop: true, kind: state, ...performanceMeta(perf) });
  }

  /** IDLE 且有内部概率链时，把调用转给它；否则返回 null（不做任何事） */
  _idleChainIfIdle() {
    return this.state === 'IDLE' && this._idleChain ? this._idleChain : null;
  }

  /** 让路（见 ChainDriver.hold）：只在 IDLE 委托给概率链时生效，其它状态 no-op */
  hold(ms) { const c = this._idleChainIfIdle(); if (c) c.hold(ms); }
  /** 立即换下一个自主动作（走到边缘时 DeskPet 调用）：只在 IDLE 委托给概率链时生效 */
  pickNext() { const c = this._idleChainIfIdle(); if (c) c.pickNext(); }
  /** 动作展示时长：IDLE 时按概率链的 playMs，其它状态返回 null（状态动作不会被掷骰顶掉，不需要让路） */
  playMsFor(action) { const c = this._idleChainIfIdle(); return c ? c.playMsFor(action) : null; }

  /**
   * 点击：配置了 clickAction 就播它；否则 IDLE 且概率链有 clicks 时委托给概率链的点击表演
   * （让清霄这类在 chain.clicks 里写表演对象的素材包在 statemachine 模式下也能点击互动）。
   */
  click() {
    if (this.clickAction) { this._emit(this.clickAction, { loop: false, kind: 'CLICK' }); return; }
    const c = this._idleChainIfIdle();
    if (c && c.clicks.length) c.click();
  }

  /** loop:false 动作（如 click() 触发的反应）自然播完 → 强制重新求值一次状态，
   *  没有更高优先级任务时会自然落回当前语义状态对应的（循环）动作，不会停在最后一帧。 */
  onEnded(action) {
    if (action !== this.current) return; // 已经被切走，忽略过期回调
    this.lastChangeAt = 0; // 绕开 minStateMs 节流，确保立即重新 emit
    this._emitState(this.state);
  }

  get semanticState() { return this.state; }
}

registerDriver('statemachine', StateDriver);
