// spritesheet.js — 精灵表逐帧渲染器（canvas 切图）。
//
// 素材包契约：
//   assets.baseUrl + assets.sheet         精灵表图片
//   assets.grid = { cols, cellW, cellH }   网格
//   assets.actions[action] = { row, durations:[ms,...] }  行号 + 每帧时长
//   （action 即“动画行”，Driver 选 action，渲染器逐帧循环）
import { RendererBase, registerRenderer } from './renderer-base.js';

export class SpriteSheetRenderer extends RendererBase {
  async mount() {
    this.baseUrl = this.assets.baseUrl || '';
    this.grid = this.assets.grid;
    const cv = document.createElement('canvas');
    cv.width = this.grid.cellW; cv.height = this.grid.cellH;
    cv.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
    this.container.appendChild(cv);
    this.cv = cv; this.ctx = cv.getContext('2d'); this.ctx.imageSmoothingEnabled = false;
    this.img = await new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej;
      im.src = this.baseUrl + this.assets.sheet;
    });
    this.frameIndex = 0; this.timer = null;
  }

  play(action) {
    const def = this.assets.actions[action];
    if (!def) return;
    this.currentAction = action; this.def = def; this.frameIndex = 0;
    this._schedule();
  }

  _draw() {
    const { cellW, cellH, cols } = this.grid;
    const i = this.frameIndex % this.def.durations.length;
    const sx = i * cellW, sy = this.def.row * cellH;
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    this.ctx.save();
    if (this.facing === 'right') { this.ctx.translate(this.cv.width, 0); this.ctx.scale(-1, 1); }
    this.ctx.drawImage(this.img, sx, sy, cellW, cellH, 0, 0, this.cv.width, this.cv.height);
    this.ctx.restore();
  }

  _schedule() {
    if (this.timer) clearTimeout(this.timer);
    this._draw();
    const dur = this.def.durations[this.frameIndex % this.def.durations.length] ?? 150;
    this.timer = setTimeout(() => { this.frameIndex++; this._schedule(); }, dur);
  }

  setFacing(dir) { super.setFacing(dir); }
  destroy() { if (this.timer) clearTimeout(this.timer); if (this.cv && this.cv.parentNode) this.cv.parentNode.removeChild(this.cv); }
}

registerRenderer('spritesheet', SpriteSheetRenderer);
