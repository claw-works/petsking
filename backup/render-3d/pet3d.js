// pet3d.js — Three.js 3D 宠物：场景 + 模型 + 关节补间
//
// 第五种渲染载体：真 3D。宠物用基础几何体（球/胶囊）拼成，各部件是 THREE.Group（关节），
// 动画靠补间各关节的 rotation/position/scale——和 SVG 骨骼同思路，但在 3D 空间里，
// 有真实光照、阴影、透视和自由旋转。
//
// Three.js 经 importmap 从 CDN 加载（纯静态，无需打包）。

import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** 一个关节的可动通道：rotation(xyz) + position(xyz) + scale(xyz) */
function freshChannel() {
  return { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, sx: 1, sy: 1, sz: 1 };
}

export class Pet3D {
  constructor(container, color) {
    this.container = container;
    this.color = color || { skin: 0xffe0d0, hair: 0x6b4a3a, cloth: 0xff9db0, skirt: 0xe86a86, cheek: 0xff8fa3, eye: 0x5a3a52 };
    this._initScene();
    this._buildPet();
    this._initRig();
    this._bindResize();
  }

  _initScene() {
    const w = this.container.clientWidth || 360;
    const h = this.container.clientHeight || 400;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    this.camera.position.set(0, 0.9, 6.8);
    this.camera.lookAt(0, 0.55, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // 灯光：环境 + 主光（投影）+ 补光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 20;
    key.shadow.camera.left = -5; key.shadow.camera.right = 5;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9db4ff, 0.4);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);

    // 地面（接收阴影）
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4, 48),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.05;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  _mat(color, rough = 0.55) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  }

  /**
   * 贴图接口：给某个部件材质挂 texture map。
   * 后续加贴图时调用，例如 pet.setTexture('face', 'assets/face.png')。
   * name 对应 this.mats 里的键：skin / cloth / hair / skirt / shoe。
   */
  setTexture(name, url) {
    const mat = this.mats && this.mats[name];
    if (!mat) return;
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      mat.map = tex;
      mat.needsUpdate = true;
    });
  }

  _buildPet() {
    const c = this.color;
    this.root = new THREE.Group();
    this.scene.add(this.root);

    // 集中管理材质，贴图接口按名字挂 map（后续 setTexture 用）
    this.mats = {
      skin: this._mat(c.skin, 0.75),
      hair: this._mat(c.hair, 0.6),
      cloth: this._mat(c.cloth, 0.7),
      skirt: this._mat(c.skirt, 0.7),
      shoe: this._mat(c.skirt, 0.5),
      ink: this._mat(c.eye, 0.35),
      white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
    };
    const M = this.mats;
    const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 12, 16);

    // ============ 身体（chibi：小小躯干 + 裙子）============
    const body = new THREE.Group();
    const torso = new THREE.Mesh(capsule(0.42, 0.35), M.cloth);
    torso.castShadow = true;
    body.add(torso);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.72, 0.5, 24, 1, true), M.skirt);
    skirt.position.y = -0.42; skirt.castShadow = true;
    body.add(skirt);
    const hem = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.72, 24), M.skirt);
    hem.rotation.x = -Math.PI / 2; hem.position.y = -0.67;
    body.add(hem);
    body.position.y = 0.15;
    this.root.add(body);

    // ============ 头（chibi：超大）============
    const head = new THREE.Group();
    const HR = 0.92;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(HR, 32, 28), M.skin);
    headMesh.scale.set(1, 0.98, 0.96); headMesh.castShadow = true;
    head.add(headMesh);

    // 头发：后脑大球 + 刘海
    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(HR * 1.04, 32, 28, 0, Math.PI * 2, 0, Math.PI * 0.62), M.hair);
    hairBack.castShadow = true;
    head.add(hairBack);
    const bang = new THREE.Mesh(new THREE.SphereGeometry(HR * 1.02, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.32), M.hair);
    bang.position.set(0, 0.12, 0.04);
    head.add(bang);
    const bangMid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), M.hair);
    bangMid.scale.set(1.4, 0.5, 0.4); bangMid.position.set(0, 0.5, HR * 0.78);
    head.add(bangMid);

    // 双马尾（锚点在头侧，可摆）
    const makeTail = (side) => {
      const g = new THREE.Group();
      const t1 = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), M.hair); t1.castShadow = true;
      const t2 = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), M.hair); t2.position.y = -0.34; t2.castShadow = true;
      const t3 = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), M.hair); t3.position.y = -0.58;
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 16), M.cloth); tie.position.y = 0.14; tie.rotation.x = Math.PI / 2;
      g.add(t1); g.add(t2); g.add(t3); g.add(tie);
      g.position.set(side * HR * 0.92, 0.28, -0.05);
      g.rotation.z = side * 0.4;
      return g;
    };
    const tailL = makeTail(-1);
    const tailR = makeTail(1);
    head.add(tailL); head.add(tailR);

    // 大眼睛
    const eyeGeo = new THREE.SphereGeometry(0.19, 20, 16);
    const eyeL = new THREE.Mesh(eyeGeo, M.ink); eyeL.scale.set(0.8, 1.15, 0.5); eyeL.position.set(-0.34, -0.02, HR * 0.86);
    const eyeR = new THREE.Mesh(eyeGeo, M.ink); eyeR.scale.set(0.8, 1.15, 0.5); eyeR.position.set(0.34, -0.02, HR * 0.86);
    head.add(eyeL); head.add(eyeR);
    this.eyeL = eyeL; this.eyeR = eyeR;
    const hi = (x, y, r) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), M.white); m.position.set(x, y, HR * 0.94); head.add(m); };
    hi(-0.30, 0.06, 0.055); hi(-0.38, -0.08, 0.03);
    hi(0.38, 0.06, 0.055); hi(0.30, -0.08, 0.03);
    // 腮红
    const cheekMat = new THREE.MeshBasicMaterial({ color: c.cheek, transparent: true, opacity: 0.55 });
    const chL = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), cheekMat); chL.position.set(-0.46, -0.28, HR * 0.8); chL.rotation.y = -0.5;
    const chR = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), cheekMat); chR.position.set(0.46, -0.28, HR * 0.8); chR.rotation.y = 0.5;
    head.add(chL); head.add(chR);
    // 小嘴
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), this._mat(0xd8607a, 0.4));
    mouth.scale.set(1.4, 0.8, 0.5); mouth.position.set(0, -0.42, HR * 0.85);
    head.add(mouth);

    head.position.set(0, 1.15, 0);
    this.root.add(head);

    // ============ 手臂（短粗，锚点在肩）============
    const makeArm = (side) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(capsule(0.14, 0.3), M.cloth); m.position.y = -0.28; m.castShadow = true;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), M.skin); hand.position.y = -0.5;
      g.add(m); g.add(hand);
      g.position.set(side * 0.5, 0.38, 0.05);
      return g;
    };
    const armL = makeArm(-1);
    const armR = makeArm(1);
    this.root.add(armL); this.root.add(armR);

    // ============ 腿（短粗 + 鞋，锚点在髋）============
    const makeLeg = (side) => {
      const g = new THREE.Group();
      const leg = new THREE.Mesh(capsule(0.14, 0.22), M.skin); leg.position.y = -0.24; leg.castShadow = true;
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), M.shoe); shoe.scale.set(1, 0.7, 1.3); shoe.position.set(0, -0.46, 0.06);
      g.add(leg); g.add(shoe);
      g.position.set(side * 0.24, -0.5, 0.05);
      return g;
    };
    const legL = makeLeg(-1);
    const legR = makeLeg(1);
    this.root.add(legL); this.root.add(legR);

    this.parts = { root: this.root, body, head, armL, armR, legL, legR, tailL, tailR, eyeL, eyeR };
  }

  _initRig() {
    this.cur = {}; this.from = {}; this.to = {};
    for (const name in this.parts) {
      this.cur[name] = freshChannel();
      this.from[name] = freshChannel();
      this.to[name] = freshChannel();
    }
    this.animT = 1; this.animStart = 0; this.animDur = 1;
    this.loopFn = null; this.phase = 0;
  }

  /** 缓动到一个姿势。pose: { partName: { rx,ry,rz, px,py,pz, sx,sy,sz } } */
  tweenTo(pose, durMs) {
    for (const name in this.parts) {
      this.from[name] = { ...this.cur[name] };
      const p = pose[name] || {};
      const base = freshChannel();
      this.to[name] = { ...base, ...p };
    }
    this.animStart = performance.now();
    this.animDur = Math.max(1, durMs);
    this.animT = 0;
  }

  setLoop(fn) { this.loopFn = fn; }

  _applyChannel(name, add) {
    const c = this.cur[name], a = add || {};
    const g = this.parts[name];
    g.rotation.set(c.rx + (a.rx || 0), c.ry + (a.ry || 0), c.rz + (a.rz || 0));
    // position/scale：建模时的初值作为基准，补间是相对基准的偏移/乘数
    if (!g.userData.base) {
      g.userData.base = { x: g.position.x, y: g.position.y, z: g.position.z };
      g.userData.baseScale = { x: g.scale.x, y: g.scale.y, z: g.scale.z };
    }
    const b = g.userData.base;
    g.position.set(b.x + c.px + (a.px || 0), b.y + c.py + (a.py || 0), b.z + c.pz + (a.pz || 0));
    const bs = g.userData.baseScale;
    g.scale.set(bs.x * c.sx * (a.sx ?? 1), bs.y * c.sy * (a.sy ?? 1), bs.z * c.sz * (a.sz ?? 1));
  }

  update(now) {
    if (this.animT < 1) {
      this.animT = Math.min(1, (now - this.animStart) / this.animDur);
      const e = ease(this.animT);
      for (const name in this.parts) {
        const f = this.from[name], t = this.to[name], c = this.cur[name];
        for (const k in c) c[k] = lerp(f[k], t[k], e);
      }
    }
    this.phase += 0.016;
    const add = this.loopFn ? this.loopFn(this.phase) : null;
    for (const name in this.parts) this._applyChannel(name, add && add[name]);
    this.renderer.render(this.scene, this.camera);
  }

  _bindResize() {
    this._onResize = () => {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}

// —— 动作姿势库 —— rotation 单位是弧度
const R = (deg) => (deg * Math.PI) / 180;
const breathe = (ph) => ({ body: { sy: 1 + Math.sin(ph * 1.6) * 0.03, py: Math.sin(ph * 1.6) * 0.03 }, head: { py: Math.sin(ph * 1.6) * 0.03 } });
const bob = (ph) => ({ root: { py: Math.abs(Math.sin(ph * 6)) * 0.18 } });

export const POSES3D = {
  idle: { pose: {}, dur: 400, loop: breathe },
  blink: { pose: { eyeL: { sy: 0.1 }, eyeR: { sy: 0.1 } }, dur: 100, loop: breathe },
  // 挥右手：绕 z 抬起 + 摆
  wave: { pose: { armR: { rz: R(-70) } }, dur: 300, loop: (ph) => ({ armR: { rz: Math.sin(ph * 12) * 0.4 }, head: { rz: R(4) } }) },
  // 走：手脚反相摆（绕 x），整体微上下，双马尾甩动
  walk: { pose: {}, dur: 200, loop: (ph) => ({
    armL: { rx: Math.sin(ph * 8) * 0.6 }, armR: { rx: -Math.sin(ph * 8) * 0.6 },
    legL: { rx: -Math.sin(ph * 8) * 0.5 }, legR: { rx: Math.sin(ph * 8) * 0.5 },
    root: { py: Math.abs(Math.sin(ph * 8)) * 0.08, ry: 0 },
    tailL: { rx: Math.sin(ph * 8) * 0.3 }, tailR: { rx: Math.sin(ph * 8 + 0.4) * 0.3 },
  }) },
  // 跳
  jump: { pose: { legL: { sy: 0.7 }, legR: { sy: 0.7 } }, dur: 150, loop: bob },
  // 欢呼：双手举高 + 蹦
  cheer: { pose: { armL: { rz: R(140) }, armR: { rz: R(-140) } }, dur: 220, loop: bob },
  // 转圈：整体绕 y 自转
  spin: { pose: {}, dur: 200, loop: (ph) => ({ root: { ry: (ph * 2.2) % (Math.PI * 2) } }) },
  // 跳舞：扭 + 摆手 + 马尾飞扬
  dance: { pose: {}, dur: 250, loop: (ph) => ({
    root: { rz: Math.sin(ph * 5) * 0.18, py: Math.abs(Math.sin(ph * 10)) * 0.1 },
    armL: { rz: Math.sin(ph * 5) * 0.8 }, armR: { rz: Math.sin(ph * 5) * 0.8 },
    head: { rz: -Math.sin(ph * 5) * 0.15 },
    tailL: { rz: Math.sin(ph * 5) * 0.4 }, tailR: { rz: Math.sin(ph * 5) * 0.4 },
  }) },
  // 点头思考
  nod: { pose: {}, dur: 300, loop: (ph) => ({ head: { rx: Math.sin(ph * 3) * 0.2 + 0.1 } }) },
  // 睡觉：头垂 + 慢呼吸
  sleep: { pose: { head: { rx: R(22), py: -0.1 }, body: {} }, dur: 500, loop: (ph) => ({ body: { sy: 1 + Math.sin(ph * 0.9) * 0.04 }, root: { py: Math.sin(ph * 0.9) * 0.04 } }) },
  // 害羞：双手上抬挡脸 + 缩
  shy: { pose: { armL: { rz: R(95), px: 0.3, py: 0.55 }, armR: { rz: R(-95), px: -0.3, py: 0.55 }, root: { sy: 0.95 } }, dur: 260, loop: (ph) => ({ root: { rz: Math.sin(ph * 1.4) * 0.05 } }) },
};

export const COLORS3D = {
  樱花: { skin: 0xffe0d0, hair: 0x6b4a3a, cloth: 0xff9db0, skirt: 0xe86a86, cheek: 0xff8fa3, eye: 0x5a3a52 },
  薄荷: { skin: 0xffe4d6, hair: 0x3a5a4a, cloth: 0x7fc98f, skirt: 0x4fa86a, cheek: 0xff9db0, eye: 0x2f4a3a },
  星空: { skin: 0xffe0d8, hair: 0x4a4a7a, cloth: 0x7d8cff, skirt: 0x4d5edb, cheek: 0xff9db0, eye: 0x2b2f55 },
};
