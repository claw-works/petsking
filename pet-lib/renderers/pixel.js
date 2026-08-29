// pixel.js — 像素 canvas 手绘渲染器（fillRect 逐格）。零位图。
//
// 素材包契约：
//   assets.palette = { char: '#hex', ... }         调色板（'.'=透明）
//   assets.grid = { w, h }                          网格尺寸
//   assets.frames = { frameKey: [ '....', ... ] }   每个帧键 = 一张字符网格
//   assets.actions[action] = [frameKey, ...]        动作 = 帧键序列（循环）
//   assets.frameMs (可选, 默认 260)                  每帧切换毫秒
import { RendererBase, registerRenderer } from './renderer-base.js';

export class PixelRenderer extends RendererBase {
  async mount() {
    this.grid = this.assets.grid;
    this.frameMs = this.assets.frameMs ?? 260;
    const cv = document.createElement('canvas');
    cv.width = this.grid.w; cv.height = this.grid.h;
    cv.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
    this.container.appendChild(cv);
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.seq = this.assets.actions[Object.keys(this.assets.actions)[0]] || ['I'];
    this.step = 0; this.lastAt = 0;
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  play(action) {
    const seq = this.assets.actions[action];
    if (!seq) return;
    this.currentAction = action; this.seq = seq; this.step = 0;
  }

  _drawFrame(rows) {
    const { w, h } = this.grid;
    const sc = this.cv.width / w;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.save();
    if (this.facing === 'right') { ctx.translate(this.cv.width, 0); ctx.scale(-1, 1); }
    for (let y = 0; y < rows.length; y++) {
      const r = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = r[x];
        if (ch === '.' || ch === undefined) continue;
        ctx.fillStyle = this.assets.palette[ch] || '#f0f';
        ctx.fillRect(x * sc, y * sc, sc, sc);
      }
    }
    ctx.restore();
  }

  _loop(now) {
    if (now - this.lastAt >= this.frameMs) {
      this.lastAt = now;
      const key = this.seq[this.step % this.seq.length];
      const frame = this.assets.frames[key] || this.assets.frames.I;
      if (frame) this._drawFrame(frame);
      this.step++;
    }
    this._raf = requestAnimationFrame(this._loop);
  }

  setFacing(dir) { super.setFacing(dir); }
  destroy() { if (this._raf) cancelAnimationFrame(this._raf); if (this.cv && this.cv.parentNode) this.cv.parentNode.removeChild(this.cv); }
}

registerRenderer('pixel', PixelRenderer);
