// gltf.js — GLTF 3D 角色渲染器（骨骼动画 + morph 表情 + 口型 + 程序化手势）
//
// 素材包契约（pet.json，路径相对 assetsDir）：
//   model        "model.glb"
//   camera       "full" | "bust" | { position:[x,y,z], target:[x,y,z], fov }
//   turnDeg      setFacing 左/右时身体转多少度（默认 70）
//   shadow       false 关掉脚下软阴影
//   expressions / blush / fur / springBones / gestureBones   见 _gltf-character.js / _gltf-gestures.js
//   actions[动作] = "ClipName" | { clip, once?, yaw?, speed?, speedScale? }
//     once   只播一遍，播完淡回待机 clip（idle 动作 → actions 里第一个非 once 且 clip 存在的动作）
//     yaw    播这个动作时身体朝向（度，正 = 朝屏幕右）；不写则跟随 setFacing
//     speed  clip 的真实行进速度 m/s（走动平移按它换算像素速度，脚不打滑）
// three 与 GLTFLoader 通过页面 importmap（'three'、'three/addons/'）或打包器解析；全部动态 import。
import { RendererBase, registerRenderer } from './renderer-base.js';

export class GltfRenderer extends RendererBase {
  get capabilities() { return { expression: true, mouth: true, gesture: true }; }

  async mount() {
    const [THREE, { GLTFLoader }, { Character, disposeObject }, { GestureLayer }, math] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('./_gltf-character.js'),
      import('./_gltf-gestures.js'),
      import('./gltf-math.js'),
    ]);
    if (this._destroyed) return; // import 期间已销毁：还没建任何资源
    this.THREE = THREE;
    this._math = math;
    this._dispose = disposeObject;
    this._buildScene();

    const onProgress = this._showProgress();
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(this.assets.baseUrl + this.assets.model, onProgress);
    } catch (e) {
      if (this._destroyed) return;
      this._showError('模型加载失败：' + (e && e.message ? e.message : e));
      throw e;
    } finally {
      this._hideProgress();
    }
    if (this._destroyed) { disposeObject(gltf.scene); this.destroy(); return; }

    const a = this.assets;
    this.character = new Character(gltf, { expressions: a.expressions, blush: a.blush, fur: a.fur, springBones: a.springBones });
    this.gestures = new GestureLayer(this.character.root, a.gestureBones);
    this.character.gestureLayer = this.gestures;
    this.character.onOnceEnd = () => this._onOnceEnd();
    this.scene.add(this.character.root);
    // 用待机姿势取景（bind pose 是 T 字，包围盒偏宽）：先播待机 clip，update(0) 让 mixer 写入首帧姿势
    const idle = this._idleSpec();
    if (idle && this.character.play(idle.clip, { once: !!idle.once, fade: 0 })) this.currentAction = idle.action;
    this.character.update(0);
    this._frame();

    this._clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  _buildScene() {
    const THREE = this.THREE;
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 500;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(w, h);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.container.appendChild(r.domElement);
    this.webgl = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 100);

    // 灯光沿用清霄展示页：主光（投影）+ 冷补光 + 顶补 + 正面暖补 + 轮廓光 + 半球光
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    key.position.set(0.6, 4.6, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2; key.shadow.camera.right = 2;
    key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const add = (color, intensity, x, y, z) => {
      const l = new THREE.DirectionalLight(color, intensity);
      l.position.set(x, y, z);
      this.scene.add(l);
    };
    add(0xbcd0ff, 0.9, -2.6, 1.8, 1.6);
    add(0xffffff, 0.7, 0.2, 5.0, 0.3);
    add(0xffe8d0, 0.9, 0, 1.6, 3.2);
    add(0xdfe8ff, 1.6, -0.8, 2.6, -3.0);
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x223344, 0.75));

    if (this.assets.shadow !== false) {
      const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.ShadowMaterial({ opacity: 0.25 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
      this._ground = ground; // 高度在 _frame() 里对齐到脚底
    }

    // 容器尺寸变化（playground setSize、窗口缩放）
    this._ro = new ResizeObserver(() => {
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      if (!cw || !ch) return;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.webgl.setSize(cw, ch);
    });
    this._ro.observe(this.container);
  }

  /** 按模型包围盒 / 头骨自动取景，或用 pet.json camera 显式指定 */
  _frame() {
    const THREE = this.THREE;
    const root = this.character.root;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (this._ground && isFinite(box.min.y)) this._ground.position.y = box.min.y;
    const headBone = root.getObjectByName((this.assets.gestureBones && this.assets.gestureBones.head) || 'Bip001Head');
    const headY = headBone ? headBone.getWorldPosition(new THREE.Vector3()).y : null;
    const cam = this.assets.camera;
    let f;
    if (cam && typeof cam === 'object') {
      const [px, py, pz] = cam.position, [tx, ty, tz] = cam.target;
      f = { position: cam.position, target: cam.target, fov: cam.fov ?? 30, distance: Math.hypot(px - tx, py - ty, pz - tz) };
    } else {
      f = this._math.frameCamera({ mode: cam || 'full', minY: box.min.y, height: size.y || 1.7, headY, fovDeg: 30 });
    }
    this.camera.fov = f.fov;
    this.camera.position.set(...f.position);
    this.camera.lookAt(...f.target);
    this.camera.updateProjectionMatrix();
    this._camDist = f.distance;
  }

  _spec(action) {
    const v = (this.assets.actions || {})[action];
    if (v == null) return this.character && this.character.actions[action] ? { clip: action } : null;
    return typeof v === 'string' ? { clip: v } : v;
  }

  /**
   * 待机动作 spec（附带 action 名）：候选依次为 idle 动作、actions 里的每个动作（按声明顺序）；
   * 跳过 once 型和 clip 不在模型里的候选，返回第一个有效的；都没有返回 null
   */
  _idleSpec() {
    const names = ['idle', ...Object.keys(this.assets.actions || {})];
    for (const name of names) {
      const s = this._spec(name);
      if (!s || s.once) continue;
      if (!this.character || !this.character.actions[s.clip]) continue;
      return { ...s, action: name };
    }
    return null;
  }

  _facingYawDeg() {
    const t = this.assets.turnDeg ?? 70;
    return this.facing === 'left' ? -t : this.facing === 'right' ? t : 0;
  }

  play(action) {
    if (!this.character) return;
    const spec = this._spec(action);
    if (!spec) return; // 本皮肤没有这个动作（如通用意图表里的 dance）：忽略
    if (!this.character.play(spec.clip, { once: !!spec.once })) {
      // pet.json 指向的 clip 在 GLB 里不存在：每个 clip 名只警告一次，保持当前动作与朝向
      this._missingClips = this._missingClips || new Set();
      if (!this._missingClips.has(spec.clip)) {
        this._missingClips.add(spec.clip);
        console.warn('[gltf] clip not found in model:', spec.clip, '(action ' + action + ')');
      }
      return;
    }
    this.currentAction = action;
    this.character.setYaw(((spec.yaw ?? this._facingYawDeg()) * Math.PI) / 180);
  }

  _onOnceEnd() {
    const idle = this._idleSpec();
    if (idle && !idle.once && this.character.play(idle.clip, { fade: 0.5 })) {
      this.character.setYaw(((idle.yaw ?? this._facingYawDeg()) * Math.PI) / 180);
      this.currentAction = idle.action;
    } // 没有可回的待机 clip：停在末帧，只通知播完
    if (this._onEnded) this._onEnded();
  }

  setFacing(dir) {
    super.setFacing(dir);
    if (!this.character) return;
    const spec = this._spec(this.currentAction);
    if (!spec || spec.yaw == null) this.character.setYaw((this._facingYawDeg() * Math.PI) / 180);
  }

  /** 走动动作的容器平移速度（px/s），让脚步与位移一致；动作没声明 speed 返回 null */
  getWalkSpeedPx(action) {
    const spec = this._spec(action);
    if (!spec || !spec.speed || !this._camDist) return null;
    return this._math.walkSpeedPx({
      speed: spec.speed, yawDeg: spec.yaw ?? 90, fovDeg: this.camera.fov,
      distance: this._camDist, heightPx: this.container.clientHeight, scale: spec.speedScale ?? 1,
    });
  }

  setExpression(name) { if (this.character) this.character.setExpression(name); }
  listExpressions() {
    if (!this.character) return [];
    return Object.entries(this.character.expressions).map(([id, p]) => ({ id, label: p.label || id }));
  }
  setMouth(frame) { if (this.character) this.character.setMouth(frame); }
  setGesture(name) { if (this.gestures) this.gestures.set(name); }
  listGestures() { return this.gestures ? this.gestures.list() : []; }

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);
    this.character.update(dt);
    if (this._destroyed) return; // update 回调（如一次型播完）里可能已销毁
    this.webgl.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this._loop);
  }

  _showProgress() {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:15%;right:15%;bottom:12%;height:4px;border-radius:2px;background:rgba(127,127,127,.25);overflow:hidden';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:0;background:#5b7cfa;transition:width .2s';
    el.appendChild(bar);
    this.container.appendChild(el);
    this._progressEl = el;
    // 服务端没给 Content-Length（total=0）时显示固定 30% 的不确定态，而不是一直停在 0
    return (e) => { bar.style.width = e.total ? Math.round((e.loaded / e.total) * 100) + '%' : '30%'; };
  }

  _hideProgress() {
    if (this._progressEl) this._progressEl.remove();
    this._progressEl = null;
  }

  _showError(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff9db0;font-size:13px;text-align:center;padding:12px';
    el.textContent = msg;
    this.container.appendChild(el);
  }

  /** 可重复调用：挂载中途销毁时 mount() 会在模型加载完后再调一次做完整清理 */
  destroy() {
    this._destroyed = true;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this._hideProgress();
    if (this.character) {
      const c = this.character;
      this.character = null;
      this.gestures = null;
      c.mixer.stopAllAction();
      c.mixer.uncacheRoot(c.root);
      if (this.scene) this.scene.remove(c.root);
      if (this._dispose) this._dispose(c.root);
    }
    if (this._ground) {
      this._ground.geometry.dispose();
      this._ground.material.dispose();
      this._ground = null;
    }
    if (this.webgl) {
      const r = this.webgl;
      this.webgl = null;
      r.forceContextLoss();
      r.dispose();
      r.domElement.remove();
    }
  }
}

registerRenderer('gltf', GltfRenderer);
