// agent-bridge.js — AI / Agent 接入层
//
// 职责：把「各家 Agent / LLM / 应用」五花八门的原始事件，归一化成 StateDriver
// 认识的标准事件（session.started / agent.thinking / tool.started / task.completed …），
// 再喂给 pet。这样接入方只管转发原始事件，不用懂桌宠内部状态机。
//
// 三种接入路径：
//   1) 已是标准事件      → pet.feed(ev) 直接用
//   2) 自定义原始事件    → 注册 mapper 归一化后转发（bindEventSource）
//   3) 意图/情绪信号      → intent/emotion → 动作（reactTo），走一次性表演而非状态
//
// 完全不依赖具体 Agent 框架；接入方提供「事件源」和「映射」即可。

/** 标准事件类型（StateDriver.resolveEvent 认识的） */
export const STD_EVENTS = [
  'session.started', 'session.idle', 'agent.thinking',
  'tool.started', 'tool.completed', 'user_input.required',
  'user_input.resolved', 'task.completed', 'task.failed',
];

/**
 * 常见 Agent 事件名 → 标准事件 的内置映射（可覆盖）。
 * 覆盖 DSH / OpenAI-style / 通用命名，尽量开箱即用。
 */
export const DEFAULT_EVENT_MAP = {
  // 会话
  'session/start': 'session.started', 'session.start': 'session.started', 'start': 'session.started',
  'session/idle': 'session.idle', 'idle': 'session.idle',
  // 思考 / 流式
  'assistant/chunk': 'agent.thinking', 'message.delta': 'agent.thinking',
  'reasoning': 'agent.thinking', 'thinking': 'agent.thinking',
  // 工具
  'tool/call': 'tool.started', 'tool.start': 'tool.started', 'tool_use': 'tool.started',
  'tool/result': 'tool.completed', 'tool.end': 'tool.completed', 'tool_result': 'tool.completed',
  // 审批 / 需要用户
  'approval/asked': 'user_input.required', 'input.required': 'user_input.required',
  'approval/decided': 'user_input.resolved', 'input.resolved': 'user_input.resolved',
  // 终态
  'turn/end:completed': 'task.completed', 'task.done': 'task.completed', 'success': 'task.completed',
  'turn/end:error': 'task.failed', 'task.error': 'task.failed', 'error': 'task.failed',
};

/** 意图/情绪 → 一次性表演动作（reactTo 用；值是素材包里的动作名，可被素材包覆盖） */
export const DEFAULT_INTENT_MAP = {
  greet: 'wave', happy: 'cheer', celebrate: 'cheer', proud: 'cheer',
  shy: 'shy', sad: 'sleep', angry: 'angry', think: 'nod',
  dance: 'dance', sleep: 'sleep', wave: 'wave', jump: 'jump',
};

export class AgentBridge {
  /**
   * @param {DeskPet} pet
   * @param {Object} opts { eventMap, intentMap }
   */
  constructor(pet, opts = {}) {
    this.pet = pet;
    this.eventMap = { ...DEFAULT_EVENT_MAP, ...(opts.eventMap || {}) };
    this.intentMap = { ...DEFAULT_INTENT_MAP, ...(opts.intentMap || {}) };
    this._unbinders = [];
  }

  /** 把原始事件名归一化为标准事件；支持 'turn/end' + reason 复合键 */
  normalize(raw) {
    let key = raw.type || raw.event || raw.name;
    if (!key) return null;
    if (key === 'turn/end' && raw.reason) key = 'turn/end:' + raw.reason;
    const std = STD_EVENTS.includes(key) ? key : this.eventMap[key];
    if (!std) return null;
    return { type: std, taskId: raw.taskId || raw.sessionId, tool: raw.tool || raw.toolName };
  }

  /** 转发一个原始事件（归一化后喂给 pet 的状态机驱动） */
  dispatch(raw) {
    const ev = this.normalize(raw);
    if (ev) this.pet.feed(ev);
    return ev;
  }

  /**
   * 绑定一个事件源：source.on(evtName, handler) 风格，或传一个 subscribe 函数。
   * @param {Function} subscribe (emit) => unsubscribe   接入方在拿到原始事件时调 emit(raw)
   */
  bindEventSource(subscribe) {
    const un = subscribe((raw) => this.dispatch(raw));
    if (typeof un === 'function') this._unbinders.push(un);
    return this;
  }

  /**
   * 意图/情绪反应：让宠物做一次性表演（不改变状态机的工作状态）。
   * @param {string} intent  如 'happy' / 'greet' / 'shy'
   */
  reactTo(intent) {
    const action = this.intentMap[intent];
    if (action) this.pet.play(action, { loop: false, kind: 'REACT:' + intent });
    return action;
  }

  unbindAll() { this._unbinders.forEach((u) => u()); this._unbinders = []; }
}
