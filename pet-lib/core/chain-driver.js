// chain-driver.js — 概率动画链驱动（自主）。
//
// 掷骰 → 加权分类 → 选动作 → 播 playMs → 再掷骰，永不停止。
// config（来自素材包的 chain 段 + 用户覆盖）：
//   idle:[], actions:[], categories:[{id,weight,actions}], clicks:[]
//   weights:{ idle, action }         顶层权重（category = 100 - idle - action）
//   playMs(action) 或 playMs:number  一个动作播多久后接下一个
import { DriverBase, registerDriver } from './driver-base.js';

function pick(pool, exclude) {
  const e = exclude ? pool.filter((n) => n !== exclude) : pool;
  const s = e.length ? e : pool;
  return s[Math.floor(Math.random() * s.length)];
}
function pickCat(cats) {
  const c = cats.filter((x) => x.actions.length);
  if (!c.length) return null;
  const total = c.reduce((s, x) => s + x.weight, 0) || 1;
  let t = Math.random() * total;
  for (const x of c) { t -= x.weight; if (t <= 0) return x; }
  return c[c.length - 1];
}
function rollKind(roll, w) {
  const top = (w.idle + w.action) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < top) return 'action';
  return 'category';
}

export class ChainDriver extends DriverBase {
  constructor(config) {
    super(config);
    this.idle = config.idle || ['idle'];
    this.actions = config.actions || [];
    this.categories = config.categories || [];
    this.clicks = config.clicks || [];
    this.weights = config.weights || { idle: 40, action: 30 };
    this._playMs = config.playMs || (() => 2600);
    this.timer = null;
    this.paused = false;
  }

  _ms(action) { return typeof this._playMs === 'function' ? this._playMs(action) : this._playMs; }

  start() { this._chain(pick(this.idle), 'IDLE'); }
  stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.paused = true; }

  _chain(action, kind) {
    this._emit(action, { loop: false, kind });
    if (this.timer) clearTimeout(this.timer);
    if (this.paused) return;
    this.timer = setTimeout(() => this.pickNext(), this._ms(action));
  }

  pickNext() {
    if (this.paused) return;
    const roll = Math.random();
    const k = rollKind(roll, this.weights);
    let next, kind;
    if (k === 'idle') { kind = 'IDLE'; next = pick(this.idle, this.current); }
    else if (k === 'action') { kind = 'ACTION'; next = pick(this.actions.length ? this.actions : this.idle, this.current); }
    else { const c = pickCat(this.categories); if (c) { kind = c.id; next = pick(c.actions, this.current); } else { kind = 'IDLE'; next = pick(this.idle, this.current); } }
    this._chain(next, kind);
  }

  click() {
    if (!this.clicks.length) return;
    const a = pick(this.clicks);
    this._emit(a, { loop: false, kind: 'CLICK' });
    if (this.timer) clearTimeout(this.timer);
    if (!this.paused) this.timer = setTimeout(() => this.pickNext(), this._ms(a));
  }
}

registerDriver('chain', ChainDriver);
