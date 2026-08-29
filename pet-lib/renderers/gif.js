// gif.js — GIF 渲染器（<img> 换 src）。素材包 actions[action] = gif 文件名。
import { RendererBase, registerRenderer } from './renderer-base.js';

export class GifRenderer extends RendererBase {
  async mount() {
    this.baseUrl = this.assets.baseUrl || '';
    const img = document.createElement('img');
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
    this.container.appendChild(img);
    this.img = img;
    // 预加载
    for (const f of Object.values(this.assets.actions)) { const i = new Image(); i.src = this.baseUrl + f; }
  }

  play(action, meta = {}) {
    const file = this.assets.actions[action];
    if (!file) return;
    this.currentAction = action;
    // 加时间戳强制 GIF 从头播
    this.img.src = this.baseUrl + file + (meta.restart ? ('?t=' + Date.now()) : '');
    this.img.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
    // GIF 无 ended 事件，非循环动作由 Driver 用 playMs 计时接链
  }

  setFacing(dir) { super.setFacing(dir); if (this.img) this.img.style.transform = dir === 'right' ? 'scaleX(-1)' : ''; }
  destroy() { if (this.img && this.img.parentNode) this.img.parentNode.removeChild(this.img); this.img = null; }
}

registerRenderer('gif', GifRenderer);
