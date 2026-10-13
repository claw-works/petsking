// _springbones.js — 弹簧骨骼（原样移植自清霄 qingxiao-pet/src/springbones.js）
import * as THREE from 'three';

// Lightweight spring-bone solver (VRM-style verlet) for cloth, tails and hair.
//
// The walk/run clips come from the shared BaseAnim pack, which only keys the
// 197 body bones: skirt, coat tails and hair would otherwise stay frozen in
// their bind pose and the legs cut through them. Each simulated bone follows
// the pose of the current clip (its "rest" target), plus inertia, gravity and
// collision against capsules around the legs / body.
//
// Config (manifest "springBones"):
// {
//   "chains": [ { "roots": "<regex on bone name>", "stiffness": 1.2, "drag": 0.35,
//                 "gravity": 0.6, "hitRadius": 0.015 } ],
//   "colliders": [ { "from": "Bip001LThigh", "to": "Bip001LCalf", "radius": [0.08, 0.06] },
//                  { "from": "Bip001Head", "radius": 0.09, "offset": [0, 0.08, 0] } ],
//   "worldMotion": 0.2   // share of root translation felt as inertia (0 = none, 1 = full)
// }
// Units are meters (world space). offset is in the bone's local space, meters.

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const GRAVITY_DIR = new THREE.Vector3(0, -1, 0);

export class SpringBones {
  constructor(root, cfg = {}) {
    this.root = root;
    this.joints = [];
    this.colliders = [];
    this.enabled = true;
    this.worldMotion = cfg.worldMotion ?? 0.2;
    this._lastRootPos = new THREE.Vector3();
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    root.updateMatrixWorld(true);

    const claimed = new Set();
    for (const chain of cfg.chains || []) {
      const rx = new RegExp(chain.roots);
      const params = {
        stiffness: chain.stiffness ?? 1.0,
        drag: chain.drag ?? 0.4,
        gravity: chain.gravity ?? 0.5,
        hitRadius: chain.hitRadius ?? 0.015,
        maxAngle: THREE.MathUtils.degToRad(chain.maxAngle ?? 60),
      };
      // chain roots = matching bones whose parent does not match
      for (const b of Object.values(bones)) {
        if (!rx.test(b.name) || (b.parent && rx.test(b.parent.name))) continue;
        b.traverse((d) => {
          if (d.isBone && !claimed.has(d)) {
            claimed.add(d);
            this._addJoint(d, params);
          }
        });
      }
    }
    // parents before children (traverse order already guarantees that per chain)
    for (const c of cfg.colliders || []) {
      const from = bones[c.from];
      if (!from) continue;
      const r = Array.isArray(c.radius) ? c.radius : [c.radius, c.radius];
      this.colliders.push({
        from, to: c.to ? bones[c.to] : null, r0: r[0], r1: r[1],
        // offset is given in meters; bone-local units are the model's (cm)
        offset: c.offset ? new THREE.Vector3(...c.offset).divideScalar(from.getWorldScale(new THREE.Vector3()).x) : null,
        a: new THREE.Vector3(), b: new THREE.Vector3(),
      });
    }
    // Some tails are authored inside a collider in the bind pose (belt flaps,
    // hip ornaments, the ahoge inside the head capsule). Shoving them fully out
    // twists them violently, but ignoring the collider altogether lets the leg
    // pass straight through the upper skirt. So each joint gets a per-collider
    // allowance = how deep its tail sat at bind pose: it may stay that deep,
    // never deeper.
    this._updateColliders();
    for (const j of this.joints) {
      j.allow = new Float32Array(this.colliders.length);
      _v1.setFromMatrixPosition(j.bone.matrixWorld);
      _q1.setFromRotationMatrix(_m1.extractRotation(j.bone.matrixWorld));
      const tail = _v3.copy(j.axis).applyQuaternion(_q1).multiplyScalar(j.length).add(_v1);
      this.colliders.forEach((c, k) => {
        j.allow[k] = Math.max(0, this._depth(c, tail, j.params.hitRadius));
      });
    }
    this._needsReset = true;
  }

  _updateColliders() {
    for (const c of this.colliders) {
      if (c.offset) c.a.copy(c.offset).applyMatrix4(c.from.matrixWorld);
      else c.a.setFromMatrixPosition(c.from.matrixWorld);
      if (c.to) c.b.setFromMatrixPosition(c.to.matrixWorld); else c.b.copy(c.a);
    }
  }

  _addJoint(bone, params) {
    const child = bone.children.find((c) => c.isBone);
    let axis, localLen;
    if (child) {
      axis = child.position.clone();
      localLen = axis.length();
    } else {
      // leaf: extend along the direction from the parent
      axis = bone.position.clone();
      localLen = axis.length() * 0.7;
    }
    if (localLen < 1e-6) return;
    axis.normalize();
    bone.getWorldScale(_v1);
    this.joints.push({
      bone, axis, params,
      length: localLen * _v1.x,
      animQuat: bone.quaternion.clone(),
      cur: new THREE.Vector3(),
      prev: new THREE.Vector3(),
    });
  }

  /** Teleports / clip snaps: drop the accumulated velocity. */
  reset() {
    this._needsReset = true;
  }

  /** Call BEFORE mixer.update(): undo our own rotation so a clip that does
   *  not key a bone does not inherit last frame's simulated pose. */
  restore() {
    for (const j of this.joints) j.bone.quaternion.copy(j.animQuat);
  }

  /** Call AFTER mixer.update() (and after moving the root). */
  update(dt) {
    if (!this.enabled || !this.joints.length) return;
    dt = Math.min(dt, 1 / 30);
    this.root.updateMatrixWorld(true);
    for (const j of this.joints) j.animQuat.copy(j.bone.quaternion);

    this._updateColliders();

    // Locomotion carries the cloth along: only `worldMotion` of the root's
    // translation turns into inertia (drag), the rest moves the particles with
    // the character. Otherwise at walk/run speed the drag term alone pushes
    // every tail out horizontally, as if in a gale.
    const rootPos = _v1.setFromMatrixPosition(this.root.matrixWorld);
    if (!this._needsReset && this.worldMotion < 1) {
      const carry = _v2.copy(rootPos).sub(this._lastRootPos).multiplyScalar(1 - this.worldMotion);
      for (const j of this.joints) { j.cur.add(carry); j.prev.add(carry); }
    }
    this._lastRootPos.copy(rootPos);

    if (this._needsReset) {
      for (const j of this.joints) {
        j.bone.updateWorldMatrix(false, false);
        _v1.setFromMatrixPosition(j.bone.matrixWorld);
        _q1.setFromRotationMatrix(_m1.extractRotation(j.bone.matrixWorld));
        j.cur.copy(j.axis).applyQuaternion(_q1).multiplyScalar(j.length).add(_v1);
        j.prev.copy(j.cur);
      }
      this._needsReset = false;
    }

    for (const j of this.joints) {
      const b = j.bone;
      // world transform of the bone in its animated pose (parent already solved)
      b.updateWorldMatrix(false, false);
      const head = _v1.setFromMatrixPosition(b.matrixWorld);
      const worldRot = _q1.setFromRotationMatrix(_m1.extractRotation(b.matrixWorld));
      const restDir = _v2.copy(j.axis).applyQuaternion(worldRot);

      const p = j.params;
      const inertia = _tmpA.copy(j.cur).sub(j.prev).multiplyScalar(1 - p.drag);
      const next = _v3.copy(j.cur).add(inertia)
        .addScaledVector(restDir, p.stiffness * dt)
        .addScaledVector(GRAVITY_DIR, p.gravity * dt);
      // keep bone length
      next.sub(head).normalize().multiplyScalar(j.length).add(head);
      // never swing further than maxAngle away from the animated pose
      // (short flaps on fast-moving arms would otherwise flip over)
      const dir = _tmpC.copy(next).sub(head).divideScalar(j.length);
      const ang = dir.angleTo(restDir);
      if (ang > p.maxAngle) {
        const k = p.maxAngle / ang;
        dir.multiplyScalar(k).addScaledVector(restDir, 1 - k).normalize();
        next.copy(head).addScaledVector(dir, j.length);
      }
      // collisions (no deeper than the tail sat at bind pose, see j.allow),
      // applied last so the angle clamp cannot pull a tail back into a leg
      // (two passes: escaping one capsule can land inside a neighbouring one,
      // e.g. between the thighs mid-stride)
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < this.colliders.length; k++) {
          this._collide(this.colliders[k], next, head, j.length, p.hitRadius - j.allow[k]);
        }
      }

      j.prev.copy(j.cur);
      j.cur.copy(next);

      // rotate the bone so its axis points at the simulated tail
      const dirLocal = next.sub(head).normalize().applyQuaternion(worldRot.invert());
      _q2.setFromUnitVectors(j.axis, dirLocal);
      b.quaternion.copy(j.animQuat).multiply(_q2);
      b.updateWorldMatrix(false, false);
    }
    // children of simulated bones that are not simulated themselves
    this.root.updateMatrixWorld(true);
  }

  // penetration depth of point p into capsule c (inflated by hit); <= 0 = outside
  _depth(c, p, hit) {
    const ab = _tmpA.copy(c.b).sub(c.a);
    const l2 = ab.lengthSq();
    let t = l2 > 0 ? _tmpB.copy(p).sub(c.a).dot(ab) / l2 : 0;
    t = Math.min(1, Math.max(0, t));
    const q = _tmpB.copy(c.a).addScaledVector(ab, t);
    return c.r0 + (c.r1 - c.r0) * t + hit - p.distanceTo(q);
  }

  _collide(c, p, head, length, hit) {
    // closest point on the capsule segment
    const ab = _tmpA.copy(c.b).sub(c.a);
    const l2 = ab.lengthSq();
    let t = l2 > 0 ? _tmpB.copy(p).sub(c.a).dot(ab) / l2 : 0;
    t = Math.min(1, Math.max(0, t));
    const q = _tmpB.copy(c.a).addScaledVector(ab, t);
    const r = c.r0 + (c.r1 - c.r0) * t + hit;
    const d = _tmpA.copy(p).sub(q);
    const dist = d.length();
    if (dist < r && dist > 1e-6) {
      p.copy(q).addScaledVector(d, r / dist);
      p.sub(head).normalize().multiplyScalar(length).add(head);
    }
  }
}

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
