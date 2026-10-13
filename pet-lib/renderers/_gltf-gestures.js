// _gltf-gestures.js — 把 gesture-curves 的偏移加性叠加到骨骼上
//
// 每帧在 mixer.update() 之后调用 update()：mixer 已经把 clip 姿势写进骨骼，这里在角色坐标系里再乘一个小旋转，
// 换算回骨骼局部空间。注意 three 的 PropertyMixer 只在混合值与上一帧不同时才写骨骼（如 Stand2 的 Neck
// 只有两个相同关键帧，mixer 不会每帧重写），所以 update() 会记下被改骨骼的原始 quaternion，
// Character 必须在下一帧 mixer.update() 之前调用 restore() 还原，否则偏移会逐帧累积、手势结束后也残留。
// 用角色坐标系而不是骨骼局部轴，是因为 Biped 骨骼的局部轴朝向不直观。
import * as THREE from 'three';
import { GESTURES, sampleGesture, gestureDone } from './gesture-curves.js';

const DEFAULT_BONES = { spine: 'Bip001Spine2', neck: 'Bip001Neck', head: 'Bip001Head' };
const ORDER = ['spine', 'neck', 'head']; // 父 → 子，子骨骼读取父骨骼更新后的世界姿态

const _e = new THREE.Euler();
const _d = new THREE.Quaternion();
const _dw = new THREE.Quaternion();
const _w = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _rInv = new THREE.Quaternion();

export class GestureLayer {
  /** @param boneNames 覆盖默认骨骼名 { head, neck, spine }（pet.json gestureBones） */
  constructor(root, boneNames = {}) {
    this.root = root;
    const names = { ...DEFAULT_BONES, ...(boneNames || {}) };
    this.bones = {};
    for (const k of ORDER) {
      const b = root.getObjectByName(names[k]);
      if (b) this.bones[k] = b;
      else console.warn('[gltf] gesture bone not found:', names[k]);
    }
    this.active = []; // { name, t, releasedAt }
    this._saved = new Map(); // bone → 叠加偏移前的 quaternion（restore() 还原用）
  }

  list() { return Object.keys(GESTURES); }

  /** 切换手势：旧的全部淡出，新的淡入；null 只淡出 */
  set(name) {
    for (const a of this.active) if (a.releasedAt == null) a.releasedAt = a.t;
    if (name && GESTURES[name]) this.active.push({ name, t: 0, releasedAt: null });
  }

  /** 把上一帧 update() 改过的骨骼还原成叠加前的姿势；须在 mixer.update() 之前调用 */
  restore() {
    for (const [bone, q] of this._saved) bone.quaternion.copy(q);
    this._saved.clear();
  }

  update(dt) {
    if (!this.active.length) return;
    const pose = { spine: { x: 0, y: 0, z: 0 }, neck: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 } };
    for (const a of this.active) {
      a.t += dt;
      const s = sampleGesture(a.name, a.t, a.releasedAt);
      if (!s) continue;
      for (const k of ORDER) { pose[k].x += s[k].x; pose[k].y += s[k].y; pose[k].z += s[k].z; }
    }
    this.active = this.active.filter((a) => !gestureDone(GESTURES[a.name], a.t, a.releasedAt));

    this.root.getWorldQuaternion(_r);
    _rInv.copy(_r).invert();
    for (const k of ORDER) {
      const bone = this.bones[k];
      const o = pose[k];
      if (!bone || !bone.parent || (!o.x && !o.y && !o.z)) continue;
      _d.setFromEuler(_e.set(o.x, o.y, o.z, 'YXZ'));   // 角色坐标系里的偏移
      _dw.copy(_r).multiply(_d).multiply(_rInv);       // → 世界坐标系
      bone.getWorldQuaternion(_w);                     // 内部会刷新父链 matrixWorld
      bone.parent.getWorldQuaternion(_p);
      // 两个槽映射到同一骨骼时只保存第一次（叠加前的原始姿势），否则 restore 会还原成已偏移的值
      if (!this._saved.has(bone)) this._saved.set(bone, bone.quaternion.clone());
      _w.premultiply(_dw);                             // 新世界姿态 = 偏移 × 原世界姿态
      bone.quaternion.copy(_p.invert().multiply(_w));  // 换回局部
    }
  }
}
