// webm.js — 透明 VP9-alpha webm 渲染器（双 <video> 交叉淡入 + 脚线对齐）
//
// 从原 pet.js 提炼。素材包契约：assets.actions[action] = 相对 assets.baseUrl 的文件名，
// assets.geometry = { feetRatio, aspect } 决定脚线对齐与画幅比例（支持 4:3 / 16:9 等）。

import { RendererBase, registerRenderer } from './renderer-base.js';

export class WebmRenderer extends RendererBase {
  async mount() {
    const geo = this.assets.geometry || {};
    this.feetRatio = geo.feetRatio ?? 0.9167; // 脚线占画面高度比例
    this.aspect = geo.aspect ?? (16 / 9);
    this.baseUrl = this.assets.baseUrl || '';

    const stage = document.createElement('div');
    stage.className = 'petlib-webm-stage';
    stage.style.cssText = 'position:relative;width:100%;height:100%;';

    const a = document.createElement('video');
    const b = document.createElement('video');
    for (const v of [a, b]) {
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
        'opacity:0;transition:opacity .18s ease;transform-origin:center bottom;';
    }
    a.style.opacity = '1';
    stage.appendChild(a); stage.appendChild(b);
    this.container.appendChild(stage);

    this.stage = stage; this.videoA = a; this.videoB = b;
    this.frontIndex = 0; this.gen = 0;
  }

  play(action, meta = {}) {
    const file = this.assets.actions[action];
    if (!file) return;
    this.currentAction = action;
    const loop = meta.loop !== false; // 默认循环
    const gen = ++this.gen;
    const el = this.frontIndex === 0 ? this.videoB : this.videoA;
    el.src = this.baseUrl + encodeURIComponent(file);
    el.loop = loop;
    el.onended = !loop && this._onEnded ? () => this._onEnded(action) : null;
    el.load();
    const ready = () => {
      el.removeEventListener('loadeddata', ready);
      if (this.gen !== gen) return;
      const old = this.frontIndex === 0 ? this.videoA : this.videoB;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.style.opacity = '1';
      if (old && old !== el) old.style.opacity = '0';
      this.frontIndex = this.frontIndex === 0 ? 1 : 0;
      el.play().catch(() => {});
    };
    el.addEventListener('loadeddata', ready);
    if (el.readyState >= 2) ready();
  }

  setFacing(dir) {
    super.setFacing(dir);
    const front = this.frontIndex === 0 ? this.videoA : this.videoB;
    if (front) front.style.transform = dir === 'right' ? 'scaleX(-1)' : '';
  }

  destroy() {
    this.gen++;
    if (this.stage && this.stage.parentNode) this.stage.parentNode.removeChild(this.stage);
    this.stage = this.videoA = this.videoB = null;
  }
}

registerRenderer('webm', WebmRenderer);
