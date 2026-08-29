// state-machine.js — whale-on-desk 状态机复刻（1:1 移植自 lib/pet-machine.mjs）
//
// 核心范式：Agent 事件 → 优先级仲裁状态机。宠物状态不是随机的，而是"响应式"的——
// 监听 Agent 的思考/工具/审批/完成事件，折叠成一个带优先级的状态，再映射到动画。
//
// 状态分三类：
//   durable  = 工作态，持续到下一个 durable 转移（idle / swim-fast / think / tool-run / review）
//   transient= 3 秒短动画，播完回 durable（celebrate / sink / startled / ...）
//   forced   = demo 覆盖态，压过一切
//
// 优先级仲裁：高优先级 transient 拒绝被低优先级打断；glass-tap(100)/compact(65) 最硬。

// —— 状态优先级表（源自 pet-machine.mjs 第 10-43 行）——
export const STATE_PRIORITY = {
  'glass-tap': 100, // 等待批准：最高，贴屏敲玻璃
  'poked-flail': 90, // 被双击戳后生气
  startled: 85, // 被单击惊吓
  'error-spiral': 70, // 连续报错 ≥3
  push: 68, // git push 成功
  compact: 65, // 上下文压缩中
  excited: 62, // 新任务开启（连胜 ≥2）
  'success-streak': 61, // 三连胜
  celebrate: 60, // 任务完成
  proud: 58, // 被摸后骄傲
  shy: 57, // 被摸后害羞
  'sad-puppy': 56, // 批准被拒
  sink: 55, // 任务失败 / 上下文紧张
  'tool-run': 50, // 工具执行中（durable）
  review: 48, // 读工具流（durable）
  think: 45, // 思考中（durable）
  'token-fountain': 44, // 文思泉涌（块流密集）
  'swim-fast': 40, // 高速工作（durable）
  greet: 38, // 任务开始（连胜 <2）
  'chase-fish': 36, // 玩耍：追鱼
  eat: 30, // 加餐（上下文偏高）
  shrimp: 29, // 加餐小虾（上下文 62-84%）
  'bubble-ring': 12, // 玩耍：吐圈圈
  sleep: 10, // 睡眠
  idle: 0, // 基础态
};

// transient 集合（源自 pet-machine.mjs 第 46-58 行）
const TRANSIENT = new Set([
  'celebrate', 'sink', 'poked-flail', 'startled', 'eat', 'greet', 'shrimp',
  'proud', 'shy', 'sad-puppy', 'excited', 'success-streak', 'push', 'error-spiral',
  'token-fountain', 'chase-fish', 'bubble-ring',
]);

const DURABLE = new Set(['idle', 'swim-fast', 'think', 'tool-run', 'review', 'sleep']);

const TRANSIENT_MS = 3000; // transient 播完回 durable 的时长

/**
 * whale 状态机：喂 Agent 事件，吐出当前展示状态。
 * onChange(snapshot) 在状态变化时回调。
 */
export class WhaleMachine {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.durable = 'idle';
    this.transient = null; // { state, until }
    this.forced = null;
    this.hint = null; // { say, level, title }

    // 用于折叠判定的累积量
    this.winStreak = 0;
    this.errStreak = 0;
    this.recentTools = []; // 最近工具名，判 review
    this.chunkTimes = []; // 块流时间戳，判 token-fountain
    this._transientTimer = null;
  }

  get state() {
    if (this.forced) return this.forced;
    if (this.transient && this.transient.until > Date.now()) return this.transient.state;
    return this.durable;
  }

  snapshot() {
    return { state: this.state, hint: this.hint, t: Date.now() };
  }

  _emit() {
    this.onChange(this.snapshot());
  }

  _setDurable(next) {
    if (!DURABLE.has(next)) return;
    this.durable = next;
    this._emit();
  }

  /** 优先级仲裁：仅当新 transient 优先级 ≥ 当前生效 transient 才接受 */
  _setTransient(next, hint) {
    const now = Date.now();
    const curP = this.transient && this.transient.until > now ? STATE_PRIORITY[this.transient.state] : -1;
    const nextP = STATE_PRIORITY[next] ?? 0;
    if (nextP < curP) return; // 被更高优先级压着，拒绝
    this.transient = { state: next, until: now + TRANSIENT_MS };
    if (hint) this.hint = hint;
    if (this._transientTimer) clearTimeout(this._transientTimer);
    this._transientTimer = setTimeout(() => {
      this.transient = null;
      this._emit();
    }, TRANSIENT_MS);
    this._emit();
  }

  /** glass-tap 是"锁定态"——审批期间压住一切，直到 approval/decided 才解除 */
  _lockGlassTap() {
    this.transient = { state: 'glass-tap', until: Date.now() + 3600_000 };
    this.hint = { say: '有个操作等你批准！' };
    if (this._transientTimer) clearTimeout(this._transientTimer);
    this._emit();
  }

  _clearGlassTap() {
    if (this.transient && this.transient.state === 'glass-tap') {
      this.transient = null;
      this._emit();
    }
  }

  // —— 事件入口（源自 pet-machine.mjs push() 第 60-180 行）——
  push(ev) {
    switch (ev.type) {
      case 'turn/start':
        if (this.winStreak >= 2) this._setTransient('excited', { say: '又有新活了，冲！' });
        else this._setTransient('greet', { say: '开工咯~' });
        this._setDurable('swim-fast');
        break;

      case 'assistant/chunk': {
        const now = Date.now();
        this.chunkTimes = this.chunkTimes.filter((t) => now - t < 2000);
        this.chunkTimes.push(now);
        if (ev.kind === 'reasoning') {
          this._setDurable('think');
        } else if (this.chunkTimes.length >= 20) {
          this._setTransient('token-fountain', { say: '文思泉涌！' });
        } else {
          this._setDurable('swim-fast');
        }
        break;
      }

      case 'tool/call': {
        this.recentTools.push(ev.tool || 'other');
        if (this.recentTools.length > 4) this.recentTools.shift();
        const allRead = this.recentTools.length >= 4 &&
          this.recentTools.every((t) => /read|grep|glob|list|search/i.test(t));
        this._setDurable(allRead ? 'review' : 'tool-run');
        break;
      }

      case 'tool/result':
        if (ev.tool && /push/i.test(ev.tool) && ev.ok) {
          this._setTransient('push', { say: '推上去了 🚀' });
        }
        break;

      case 'turn/end':
        if (ev.reason === 'error' || ev.reason === 'aborted') {
          this.winStreak = 0;
          this.errStreak += 1;
          if (this.errStreak >= 3) this._setTransient('error-spiral', { say: '又错了…深呼吸' });
          else this._setTransient('sink', { say: '呜，失败了' });
        } else {
          this.errStreak = 0;
          this.winStreak += 1;
          if (this.winStreak >= 3) this._setTransient('success-streak', { say: '三连胜！势不可挡' });
          else this._setTransient('celebrate', { say: '搞定！🎉' });
        }
        this._setDurable('idle');
        break;

      case 'approval/asked':
        this._lockGlassTap();
        break;

      case 'approval/decided':
        this._clearGlassTap();
        if (ev.approved === false) this._setTransient('sad-puppy', { say: '被拒绝了…' });
        break;

      case 'compaction/start':
        this._setTransient('compact', { say: '整理一下记忆…' });
        break;

      case 'user/poke':
        if (ev.doubleClick) this._setTransient('poked-flail', { say: '别戳啦！' });
        else this._setTransient('startled', { say: '哎呀，吓我一跳' });
        break;

      case 'user/pet':
        if (this.winStreak >= 2) this._setTransient('proud', { say: '嘿嘿，我很棒吧' });
        else if (Math.random() < 0.25) this._setTransient('shy', { say: '(害羞)' });
        break;

      case 'user/antics':
        if (ev.kind === 'chase-fish') this._setTransient('chase-fish', { say: '抓鱼咯！' });
        else this._setTransient('bubble-ring', { say: '噗噗~吐圈圈' });
        break;

      case 'session/idle':
        this._setDurable('sleep');
        break;

      case 'clock/tick':
        if (ev.contextPct >= 84) this._setTransient('sink', { say: '上下文快满了…' });
        else if (ev.contextPct >= 62) this._setTransient('shrimp', { say: '加个餐补补' });
        break;

      case 'demo/force':
        this.forced = ev.state || null;
        this._emit();
        break;
    }
  }
}
