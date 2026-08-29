// svg.js — SVG 矢量骨骼渲染器（关节补间，非切帧）。
//
// 与位图渲染器不同：这里“素材”是程序化的骨骼模型 + 姿势库，素材包只提供
//   assets.model   内置模型名（当前支持 'chibi'）
//   assets.colors  配色
//   assets.actions[action] = 姿势名（映射到内置姿势库 POSES）
// 保持与其它渲染器一致的 play(action) 接口。
import { RendererBase, registerRenderer } from './renderer-base.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const NS = 'http://www.w3.org/2000/svg';

// 内置模型：一只简约小生物（头/身/双臂/双腿/双眼）
function buildChibi(color) {
  const c = color || { body: '#4d6efa', belly: '#dbe4ff', ink: '#2b2f45', cheek: '#ff9db0' };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 220');
  svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
  const g = (p) => { const e = document.createElementNS(NS, 'g'); p.appendChild(e); return e; };
  const sh = (p, tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; };
  const body = g(svg), legL = g(body), legR = g(body), torso = g(body), armL = g(body), armR = g(body), head = g(body), eyeL = g(head), eyeR = g(head);
  sh(legL, 'ellipse', { cx: 82, cy: 192, rx: 12, ry: 15, fill: c.body, stroke: c.ink, 'stroke-width': 3 });
  sh(legR, 'ellipse', { cx: 118, cy: 192, rx: 12, ry: 15, fill: c.body, stroke: c.ink, 'stroke-width': 3 });
  sh(armL, 'ellipse', { cx: 52, cy: 128, rx: 13, ry: 18, fill: c.body, stroke: c.ink, 'stroke-width': 3 });
  sh(armR, 'ellipse', { cx: 148, cy: 128, rx: 13, ry: 18, fill: c.body, stroke: c.ink, 'stroke-width': 3 });
  sh(torso, 'ellipse', { cx: 100, cy: 135, rx: 52, ry: 50, fill: c.body, stroke: c.ink, 'stroke-width': 3.5 });
  sh(torso, 'ellipse', { cx: 100, cy: 142, rx: 34, ry: 34, fill: c.belly });
  sh(head, 'ellipse', { cx: 100, cy: 74, rx: 46, ry: 42, fill: c.body, stroke: c.ink, 'stroke-width': 3.5 });
  sh(head, 'ellipse', { cx: 74, cy: 86, rx: 8, ry: 5, fill: c.cheek, opacity: 0.7 });
  sh(head, 'ellipse', { cx: 126, cy: 86, rx: 8, ry: 5, fill: c.cheek, opacity: 0.7 });
  sh(head, 'path', { d: 'M92 92 Q100 99 108 92', fill: 'none', stroke: c.ink, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
  sh(eyeL, 'ellipse', { cx: 86, cy: 76, rx: 6, ry: 8, fill: c.ink });
  sh(eyeR, 'ellipse', { cx: 114, cy: 76, rx: 6, ry: 8, fill: c.ink });
  const anchors = { body: [100, 130], head: [100, 80], armL: [58, 120], armR: [142, 120], legL: [82, 185], legR: [118, 185], eyeL: [86, 78], eyeR: [114, 78] };
  return { svg, bones: { body, head, armL, armR, legL, legR, eyeL, eyeR }, anchors };
}

const R = (d) => d; // SVG rotate 用度
const breathe = (ph) => ({ body: { ty: Math.sin(ph * 1.6) * 2, sy: 1 + Math.sin(ph * 1.6) * 0.02 } });
const bob = (ph) => ({ body: { ty: Math.abs(Math.sin(ph * 6)) * -8 } });

// 内置姿势库（动作→姿势）。素材包 actions 值就是这里的键。
export const SVG_POSES = {
  idle: { pose: {}, loop: breathe },
  blink: { pose: { eyeL: { sy: 0.1 }, eyeR: { sy: 0.1 } }, loop: breathe },
  wave: { pose: { armR: { rot: -120 } }, loop: (ph) => ({ armR: { rot: Math.sin(ph * 12) * 18 } }) },
  walk: { pose: {}, loop: (ph) => ({ armL: { rot: Math.sin(ph * 8) * 25 }, armR: { rot: -Math.sin(ph * 8) * 25 }, legL: { rot: -Math.sin(ph * 8) * 15 }, legR: { rot: Math.sin(ph * 8) * 15 }, body: { ty: Math.abs(Math.sin(ph * 8)) * -3 } }) },
  jump: { pose: { legL: { sy: 0.7 }, legR: { sy: 0.7 } }, loop: bob },
  cheer: { pose: { armL: { rot: 130 }, armR: { rot: -130 } }, loop: bob },
  dance: { pose: {}, loop: (ph) => ({ body: { rot: Math.sin(ph * 5) * 10, ty: Math.abs(Math.sin(ph * 10)) * -4 }, armL: { rot: Math.sin(ph * 5) * 40 }, armR: { rot: Math.sin(ph * 5) * 40 } }) },
  sleep: { pose: { head: { rot: 12, ty: 6 } }, loop: (ph) => ({ body: { sy: 1 + Math.sin(ph * 0.9) * 0.03 } }) },
  shy: { pose: { armL: { rot: 90 }, armR: { rot: -90 }, body: { sy: 0.95 } }, loop: null },
};

export class SvgRenderer extends RendererBase {
  async mount() {
    const built = buildChibi(this.assets.colors);
    this.container.appendChild(built.svg);
    this.svg = built.svg; this.bones = built.bones; this.anchors = built.anchors;
    this.cur = {}; this.from = {}; this.to = {};
    for (const n in this.bones) { this.cur[n] = ch(); this.from[n] = ch(); this.to[n] = ch(); }
    this.animT = 1; this.animStart = 0; this.animDur = 300; this.loopFn = null; this.phase = 0;
    this._loop = this._loop.bind(this); this._raf = requestAnimationFrame(this._loop);
  }

  play(action) {
    const name = (this.assets.actions && this.assets.actions[action]) || action;
    const p = SVG_POSES[name] || SVG_POSES.idle;
    this.currentAction = action; this.loopFn = p.loop || null;
    for (const n in this.bones) {
      this.from[n] = { ...this.cur[n] };
      const t = p.pose[n] || {};
      this.to[n] = { rot: t.rot || 0, tx: t.tx || 0, ty: t.ty || 0, sx: t.sx ?? 1, sy: t.sy ?? 1 };
    }
    this.animStart = performance.now(); this.animT = 0;
  }

  _apply(add) {
    for (const n in this.bones) {
      const c = this.cur[n], a = (add && add[n]) || {}, [cx, cy] = this.anchors[n];
      const rot = c.rot + (a.rot || 0), tx = c.tx + (a.tx || 0), ty = c.ty + (a.ty || 0);
      const sx = c.sx * (a.sx ?? 1) * (this.facing === 'right' ? -1 : 1), sy = c.sy * (a.sy ?? 1);
      this.bones[n].setAttribute('transform', `translate(${tx} ${ty}) translate(${cx} ${cy}) rotate(${rot}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`);
    }
  }

  _loop(now) {
    if (this.animT < 1) {
      this.animT = Math.min(1, (now - this.animStart) / this.animDur);
      const e = ease(this.animT);
      for (const n in this.bones) { const f = this.from[n], t = this.to[n], c = this.cur[n]; for (const k in c) c[k] = lerp(f[k], t[k], e); }
    }
    this.phase += 0.016;
    this._apply(this.loopFn ? this.loopFn(this.phase) : null);
    this._raf = requestAnimationFrame(this._loop);
  }

  setFacing(dir) { super.setFacing(dir); }
  destroy() { if (this._raf) cancelAnimationFrame(this._raf); if (this.svg && this.svg.parentNode) this.svg.parentNode.removeChild(this.svg); }
}
function ch() { return { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1 }; }

registerRenderer('svg', SvgRenderer);
