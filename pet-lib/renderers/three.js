// three.js — Three.js 3D 渲染器（懒加载 three + 内置 chibi 模型）。
//
// 素材包契约：
//   assets.colors  配色（传给 Pet3D）
//   assets.actions[action] = 姿势名（映射到 POSES3D）
// three 通过页面 importmap 提供（'three' 裸导入）。此渲染器动态 import 模型模块。
import { RendererBase, registerRenderer } from './renderer-base.js';

export class ThreeRenderer extends RendererBase {
  async mount() {
    // 懒加载模型模块（内部 import 'three'，需页面 importmap）
    const mod = await import('./_three-model.js');
    this._mod = mod;
    this.pet = new mod.Pet3D(this.container, this.assets.colors);
    this.autoSpin = this.assets.autoSpin !== false;
    this._angle = 0;
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  play(action) {
    const name = (this.assets.actions && this.assets.actions[action]) || action;
    const P = this._mod.POSES3D[name] || this._mod.POSES3D.idle;
    this.currentAction = action;
    this.pet.setLoop(P.loop || null);
    this.pet.tweenTo(P.pose, P.dur || 300);
  }

  _loop(now) {
    if (this.autoSpin) { this._angle += 0.004; this.pet.root.rotation.y = this._angle; }
    this.pet.update(now);
    this._raf = requestAnimationFrame(this._loop);
  }

  setFacing(dir) { super.setFacing(dir); }
  destroy() { if (this._raf) cancelAnimationFrame(this._raf); if (this.pet) this.pet.dispose(); }
}

registerRenderer('three', ThreeRenderer);
