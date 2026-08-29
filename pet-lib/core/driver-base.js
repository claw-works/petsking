// driver-base.js — 驱动器统一接口
//
// 驱动器决定「现在该播哪个动作」，不关心怎么画（那是 Renderer 的事）。
//   - start()/stop()         启停
//   - feed(input)            喂外部信号（如 Agent 事件、用户交互），可选
//   - onAction(cb)           输出：cb(action, { loop, kind }) 告诉外部该播什么
//   - click()                点击回应（可选）
//
// 两种内置驱动：
//   chain        概率动画链（自主，掷骰选动作）—— 适合纯装饰/陪伴
//   statemachine Agent 事件 → 优先级状态 → 动作 —— 适合反映 AI 工作状态

export class DriverBase {
  constructor(config = {}) {
    this.config = config;
    this._actionCb = () => {};
    this.current = null;
  }
  onAction(cb) { this._actionCb = cb || (() => {}); }
  _emit(action, meta) { this.current = action; this._actionCb(action, meta || {}); }

  start() {}
  stop() {}
  feed(_input) {}   // 默认忽略外部信号（chain 是自主的）
  click() {}
}

export const DRIVERS = {};
export function registerDriver(type, cls) { DRIVERS[type] = cls; }
export function createDriver(type, config) {
  const Cls = DRIVERS[type];
  if (!Cls) throw new Error('unknown driver type: ' + type);
  return new Cls(config);
}
