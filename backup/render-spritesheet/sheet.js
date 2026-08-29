// sheet.js — sprite sheet 逐帧渲染引擎（移植自 dsh-desktop-pet 的 PetContract + AnimationController）
//
// 一张精灵表大图，按固定网格切成格子：8 列 × 9 行，每格 192×208。
// 每一行是一个动画状态，行内从左到右是该状态的连续帧，每帧有独立播放时长。

export const CELL_W = 192;
export const CELL_H = 208;
export const COLUMNS = 8;

// 9 个动画行（源自 PetContract.ts ANIMATION_ROWS），行序即精灵表里从上到下的行
export const ANIMATION_ROWS = [
  { state: 'idle', durations: [280, 110, 110, 140, 140, 320] },
  { state: 'running-right', durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'running-left', durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'waving', durations: [140, 140, 140, 280] },
  { state: 'jumping', durations: [140, 140, 140, 140, 280] },
  { state: 'failed', durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  { state: 'waiting', durations: [150, 150, 150, 150, 150, 260] },
  { state: 'running', durations: [120, 120, 120, 120, 120, 220] },
  { state: 'review', durations: [150, 150, 150, 150, 150, 280] },
];

export function rowIndexOf(state) {
  return ANIMATION_ROWS.findIndex((r) => r.state === state);
}

/** 计算第 index 帧在精灵表里的像素矩形（源自 frameRect） */
export function frameRect(state, index) {
  const ri = rowIndexOf(state);
  if (ri < 0) throw new Error('unknown state: ' + state);
  const frames = ANIMATION_ROWS[ri].durations.length;
  const i = ((index % frames) + frames) % frames;
  return { x: i * CELL_W, y: ri * CELL_H, w: CELL_W, h: CELL_H };
}

/**
 * SheetAnimator：在 canvas 上按 per-frame duration 逐帧播放 sprite sheet 的某一行。
 * 与 AnimationController 同构：state 决定播哪一行，frameIndex 循环，每帧按自身时长 setTimeout。
 */
export class SheetAnimator {
  constructor(canvas, image) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false; // 像素图保持锐利
    this.img = image;
    this.state = 'idle';
    this.frameIndex = 0;
    this.timer = null;
  }

  setState(state) {
    if (rowIndexOf(state) < 0) return;
    this.state = state;
    this.frameIndex = 0;
    this._schedule();
  }

  _draw() {
    const r = frameRect(this.state, this.frameIndex);
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    this.ctx.drawImage(this.img, r.x, r.y, r.w, r.h, 0, 0, this.cv.width, this.cv.height);
  }

  _schedule() {
    if (this.timer) clearTimeout(this.timer);
    this._draw();
    const row = ANIMATION_ROWS[rowIndexOf(this.state)];
    const dur = row.durations[this.frameIndex % row.durations.length] ?? 150;
    this.timer = setTimeout(() => {
      this.frameIndex = (this.frameIndex + 1) % row.durations.length;
      this._schedule();
    }, dur);
  }

  stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
}
