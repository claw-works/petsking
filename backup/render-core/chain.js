// chain.js — 共享的「概率动画链」驱动内核
//
// 从首页 pet.js 提炼出的纯逻辑（rollKind / pick / 加权分类 / transient），
// 与渲染方式完全解耦：内核只负责「下一个该播哪个动作、播多久」，
// 具体怎么把动作画到屏幕上由各渲染方案实现（render 回调）。
//
// 这样同一个内核可以驱动 GIF / sprite sheet 逐帧 / 像素 canvas 三种渲染。

/** 从池里等概率抽一个，exclude 避免立刻重复 */
export function pick(pool, exclude) {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
}

/** 按 weight 抽一个分类 */
function pickWeightedCategory(categories) {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const total = cats.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * total;
  for (const c of cats) { t -= c.weight; if (t <= 0) return c; }
  return cats[cats.length - 1];
}

/** 加权掷骰 → 下一个动画链的 kind（源自 pet.js rollKind） */
function rollKind(roll, w) {
  const topEnd = (w.idle + w.action) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < topEnd) return 'action';
  return 'category';
}

/**
 * ChainDriver：概率链驱动器。
 *
 * config:
 *   idle:       ['动作名', ...]              待机池
 *   actions:    ['动作名', ...]              通用动作池（等概率）
 *   categories: [{ id, weight, actions }]    加权分类池
 *   clicks:     ['动作名', ...]              点击回应池（可空）
 *   weights:    { idle, action }             顶层权重（category = 100 - idle - action）
 *   playMs(name): number                     该动作播多久（毫秒）后接下一个
 *   render(name, meta)                        渲染回调：把动作画出来
 *
 * 内核不停地掷骰 → 选动作 → render → 到时再掷骰，形成「永不停止的动画链」。
 */
export class ChainDriver {
  constructor(config) {
    this.cfg = config;
    this.current = null;
    this.timer = null;
    this.paused = false;
    this.onPick = config.onPick || (() => {});
  }

  start() {
    this._chainTo(pick(this.cfg.idle));
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** 播一个动作，到时后自动 pickNext（除非 hold=true 表示循环等待外部打断） */
  _chainTo(name, kind, hold) {
    this.current = name;
    this.cfg.render(name, { kind: kind || 'idle' });
    this.onPick(name, kind || 'idle');
    if (this.timer) clearTimeout(this.timer);
    if (hold || this.paused) return;
    const ms = this.cfg.playMs ? this.cfg.playMs(name) : 2600;
    this.timer = setTimeout(() => this.pickNext(), ms);
  }

  /** 掷骰选下一个链节点（源自 pet.js pickNext） */
  pickNext() {
    if (this.paused) return;
    const w = this.cfg.weights;
    const roll = Math.random();
    const k = rollKind(roll, w);
    let kind, next;
    if (k === 'idle') {
      kind = 'IDLE'; next = pick(this.cfg.idle, this.current);
    } else if (k === 'action') {
      kind = 'ACTION'; next = pick(this.cfg.actions, this.current);
    } else {
      const cat = pickWeightedCategory(this.cfg.categories || []);
      if (cat) { kind = cat.id; next = pick(cat.actions, this.current); }
      else { kind = 'ACTION'; next = pick(this.cfg.actions, this.current); }
    }
    this._chainTo(next, kind);
  }

  /** 点击回应：插播一个 click 动作，播完回链 */
  click() {
    const clicks = this.cfg.clicks || [];
    if (!clicks.length) return;
    const name = pick(clicks);
    this.current = name;
    this.cfg.render(name, { kind: 'CLICK' });
    this.onPick(name, 'CLICK');
    if (this.timer) clearTimeout(this.timer);
    const ms = this.cfg.playMs ? this.cfg.playMs(name) : 2000;
    this.timer = setTimeout(() => this.pickNext(), ms);
  }
}
