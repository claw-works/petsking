// rig.js — SVG 矢量骨骼渲染引擎
//
// 和位图方案（gif/spritesheet/像素）根本不同：宠物不是「一帧帧图片」，而是一组
// 矢量图形（path/ellipse），每个可动部件挂在一个「关节」上。动画不是切帧，而是
// 让关节的角度/位移在目标值之间做缓动补间（插值），rAF 每帧重算 transform。
//
// 关节（bone）：{ rot 旋转角, tx/ty 位移, sx/sy 缩放 }，各有 cx/cy 旋转锚点。
// 一个「姿势(pose)」= 给若干关节指定目标值；播动画 = 从当前值缓动到目标值。

/** 线性插值 */
const lerp = (a, b, t) => a + (b - a) * t;
/** ease-in-out 缓动 */
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Rig：管理一组命名关节，驱动 SVG <g> 的 transform。
 * bones: { name: { el, cx, cy } }  —— el 是对应的 SVG <g>，cx/cy 是旋转锚点
 */
export class Rig {
  constructor(bones) {
    this.bones = bones;
    // 每个关节的当前值 / 起始值 / 目标值
    this.cur = {};
    this.from = {};
    this.to = {};
    for (const name in bones) {
      this.cur[name] = { rot: 0, tx: 0, ty: 0, sx: 1, sy: 1 };
      this.from[name] = { ...this.cur[name] };
      this.to[name] = { ...this.cur[name] };
    }
    this.animStart = 0;
    this.animDur = 1;
    this.animT = 1; // 1 = 已到位
    this.loopPose = null; // 周期性叠加动作（呼吸/摆动）
    this.loopPhase = 0;
    this._raf = null;
  }

  /** 缓动到一个姿势。pose: { boneName: { rot, tx, ty, sx, sy } }（缺省字段回 0/1） */
  tweenTo(pose, durMs) {
    for (const name in this.bones) {
      this.from[name] = { ...this.cur[name] };
      const p = pose[name] || {};
      this.to[name] = {
        rot: p.rot ?? 0, tx: p.tx ?? 0, ty: p.ty ?? 0,
        sx: p.sx ?? 1, sy: p.sy ?? 1,
      };
    }
    this.animStart = performance.now();
    this.animDur = Math.max(1, durMs);
    this.animT = 0;
  }

  /** 设置一个每帧叠加的周期动作（如呼吸），fn(phase)->pose 增量 */
  setLoop(fn) { this.loopPose = fn; }

  start() {
    const tick = (now) => {
      // 主补间进度
      if (this.animT < 1) {
        this.animT = Math.min(1, (now - this.animStart) / this.animDur);
        const e = ease(this.animT);
        for (const name in this.bones) {
          const f = this.from[name], t = this.to[name], c = this.cur[name];
          c.rot = lerp(f.rot, t.rot, e);
          c.tx = lerp(f.tx, t.tx, e);
          c.ty = lerp(f.ty, t.ty, e);
          c.sx = lerp(f.sx, t.sx, e);
          c.sy = lerp(f.sy, t.sy, e);
        }
      }
      // 周期叠加（呼吸/待机摆动），不打断主补间
      this.loopPhase += 0.016;
      const add = this.loopPose ? this.loopPose(this.loopPhase) : null;
      this._apply(add);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }

  /** 把当前值（+可选叠加）写进每个 <g> 的 transform */
  _apply(add) {
    for (const name in this.bones) {
      const b = this.bones[name];
      const c = this.cur[name];
      const a = (add && add[name]) || {};
      const rot = c.rot + (a.rot || 0);
      const tx = c.tx + (a.tx || 0);
      const ty = c.ty + (a.ty || 0);
      const sx = c.sx * (a.sx ?? 1);
      const sy = c.sy * (a.sy ?? 1);
      // 绕锚点旋转+缩放：translate(anchor) → 变换 → translate(-anchor)
      b.el.setAttribute(
        'transform',
        `translate(${tx} ${ty}) translate(${b.cx} ${b.cy}) rotate(${rot}) scale(${sx} ${sy}) translate(${-b.cx} ${-b.cy})`,
      );
    }
  }
}
