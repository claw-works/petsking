// _gltf-character.js — GLTF 角色：clip 播放、表情 morph、口型 morph、眨眼、腮红、毛发、平滑转身
//
// 移植自清霄 qingxiao-pet/src/character.js。差异：
//   - 不含语音（由 pet-lib/voice 负责，口型经 setMouth 推进来）
//   - 不含 idle director 与根位移（待机小动作由 pet-lib 驱动调度，桌宠原地走）
//   - 表情预设可被素材包 expressions 覆盖
//   - 清霄（Kuro 导出）模型专属的修正改为可配置，通用默认全关（见 gltf.js 头注释与 docs/model-change-requests.md）：
//     scale / stripRootMotion + rootBone / materialFixes / blinkMorph / visemes / mouthMap / blush.material
import * as THREE from 'three';
import { SpringBones } from './_springbones.js';
import { VISEMES } from '../voice/visemes.js';
import { DEFAULT_MOUTH_MAP, mouthTargets } from './gltf-math.js';

// 清霄脸部 morph：B_* 眉、E_* 眼（E_Smile_L/R = 单眼笑眯）、M_* 嘴；L/R 为角色自身左右。
// blush 驱动脸部 shader 的腮红（0..1）。
export const DEFAULT_EXPRESSIONS = {
  neutral:   { label: '平静', morphs: {} },
  smile:     { label: '微笑', morphs: { B_Happy: 0.45, E_Smile_L: 0.3, E_Smile_R: 0.3, M_Smile_L: 1, M_Smile_R: 1 } },
  happy:     { label: '开心', morphs: { B_Happy: 0.9, E_Smile_L: 0.95, E_Smile_R: 0.95, M_Laugh: 0.85, M_Smile_L: 0.4, M_Smile_R: 0.4 } },
  angry:     { label: '生气', morphs: { B_Anger: 1, E_Anger: 0.85, M_Anger: 1 } },
  shy:       { label: '害羞', morphs: { B_Sad: 0.55, E_Smile_L: 0.3, E_Smile_R: 0.3, M_Smile_L: 0.55, M_Smile_R: 0.55, Pupil_Down: 0.18 }, blush: 1 },
  wink:      { label: '眨眼', morphs: { B_Happy: 0.6, E_Smile_L: 1, M_Smile_L: 0.9, M_Smile_R: 0.9, M_Laugh: 0.25 } },
  sad:       { label: '难过', morphs: { B_Sad: 1, E_Sad: 0.85, M_Ennui_L: 0.7, M_Ennui_R: 0.7 } },
  surprised: { label: '惊讶', morphs: { B_Happy: 0.7, E_Stare: 0.9, M_O: 0.75 } },
};

// 说话时要压低的「表情嘴部」morph（另外 visemes / mouthMap 里出现的 morph 也算嘴部）
const MOUTH_RE = /^(M_|Aa$|A$|E$|I$|O$|U$)/;

// Kuro（清霄）材质修正：GLB 的 alphaMode 与贴图 alpha 实际含义不符（见 docs/model-change-requests.md #1 #2）。
// 材质名形如 MI_R2T1QingxiaoMd10011Bangs / …Hair / …Face / …Up / …Down / …Cloth / …Eye / …Alpha：
//   Bangs / Hair → 镂空（alpha-test + 双面）；Up / Cloth / Down / Face / Eye → 强制不透明；其余（如 Alpha）不动。
const KURO_CUTOUT_RE = /(^|_|Md\d+)(Bangs|Hair)$/;
const KURO_OPAQUE_RE = /(^|_|Md\d+)(Up|Cloth|Down|Face)$|Eye$/;
function fixKuroMaterial(o, m) {
  const n = m.name || '';
  if (KURO_CUTOUT_RE.test(n)) {
    // 头发 / 刘海：alpha 是真实镂空，alpha-test + 双面
    m.alphaTest = 0.35;
    m.depthWrite = true;
    m.side = THREE.DoubleSide;
    m.transparent = false;
  } else if (KURO_OPAQUE_RE.test(n)) {
    // 身体 / 衣服 / 脸 / 眼：base color alpha 是无意义低值，强制不透明，否则会挖洞露出黑色背面
    m.alphaTest = 0;
    m.transparent = false;
    m.depthWrite = true;
    m.side = THREE.FrontSide;
    m.opacity = 1;
    if (m.alphaMap) m.alphaMap = null;
    o.castShadow = false; // 避免胸口 / 领口自阴影黑斑
  }
}

// materialFixes 取值 → 单个材质的修正函数
const MATERIAL_FIXES = { kuro: fixKuroMaterial };

/** 所有网格投影、不做视锥剔除（蒙皮网格包围盒不跟骨骼走）；按 materialFixes 套用材质修正 */
function prepareMeshes(root, materialFixes) {
  const fix = materialFixes ? MATERIAL_FIXES[materialFixes] : null;
  if (materialFixes && !fix) console.warn('[gltf] unknown materialFixes:', materialFixes);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    if (fix && o.material) fix(o, o.material);
  });
}

export class Character {
  /**
   * @param gltf  GLTFLoader 结果
   * @param opts  {
   *   expressions?, blush?, fur?, springBones?,
   *   scale?            模型整体缩放（默认 1；清霄以 cm 制作用 0.01，见 model-change-requests #4）
   *   stripRootMotion?  去掉 `<rootBone>.position` 轨道（默认 false；见 #3）
   *   rootBone?         根骨骼名（默认 'Root'）
   *   materialFixes?    材质修正预设（默认 null；'kuro' = 清霄，见 #1 #2）
   *   blinkMorph?       眨眼 morph 名（默认 'E_Close'；模型没有该 morph 就不眨眼）
   *   visemes?          口型表覆盖（按 viseme 名合并到 voice/visemes.js 的 VISEMES）
   *   mouthMap?         音频口型特征 → morph 映射（默认 DEFAULT_MOUTH_MAP）
   * }
   */
  constructor(gltf, opts = {}) {
    this.root = gltf.scene;
    prepareMeshes(this.root, opts.materialFixes || null);
    this.root.scale.setScalar(opts.scale ?? 1);

    this.springs = new SpringBones(this.root, opts.springBones);

    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    const rootTrack = (opts.rootBone || 'Root') + '.position';
    for (const clip of gltf.animations) {
      // 根骨骼位移轨道会在循环边界跳变，可按需去掉（桌宠原地走，平移由容器负责）
      if (opts.stripRootMotion) clip.tracks = clip.tracks.filter((t) => t.name !== rootTrack);
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.clipNames = Object.keys(this.actions);
    this.current = null;
    this.currentClip = null;
    this.onOnceEnd = null;    // (clipName) => void，一次型 clip 播完
    this.gestureLayer = null; // { restore(), update(dt) }，渲染器挂手势层（mixer 之后、弹簧骨骼之前叠加）
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current && this.onOnceEnd) this.onOnceEnd(this.currentClip);
    });
    this._targetYaw = 0;

    // morph：GLB 按材质拆成多个 Mesh，每个都带完整 morph 集合 → 全收集
    this.morphs = {};
    this.morphMeshes = [];
    this.root.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) {
        this.morphMeshes.push(o);
        for (const [name, idx] of Object.entries(o.morphTargetDictionary)) this.morphs[name] = idx;
      }
    });
    this.expressions = { ...DEFAULT_EXPRESSIONS, ...(opts.expressions || {}) };
    this.morphValues = {};   // 当前表情目标值
    this.morphCurrent = {};  // 平滑后的值
    this.expression = 'neutral';
    this._exprNoBlink = false;
    this._mouth = null;
    this.blinkMorph = opts.blinkMorph || 'E_Close';
    this.visemes = { ...VISEMES, ...(opts.visemes || {}) };
    this.mouthMap = opts.mouthMap || DEFAULT_MOUTH_MAP;
    // 嘴部 morph：默认前缀规则 + 口型表 / mouthMap 里出现的 morph
    this._mouthNames = new Set([
      ...Object.values(this.visemes).flatMap((v) => Object.keys(v || {})),
      ...Object.keys(this.mouthMap),
    ]);
    this._setupBlush(opts.blush);
    this._setupFur(opts.fur);

    this.autoBlink = true;
    this._blinkTimer = 2 + Math.random() * 3;
    this._blinkPhase = -1;
  }

  /** 播 clip。once=true 只播一遍（停在末帧并触发 onOnceEnd），否则循环。返回是否找到 clip。 */
  play(name, { once = false, fade = 0.25 } = {}) {
    const next = this.actions[name];
    if (!next) return false;
    // 已在循环播放就不打断；一次型播完被 clamp 暂停的同一 clip 再要求循环时要重新开始
    if (next === this.current && !once && next.loop === THREE.LoopRepeat && next.isRunning()) return true;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    next.play();
    this.current = next;
    this.currentClip = name;
    return true;
  }

  /** 身体朝向（弧度，0 = 面朝相机，正 = 转向屏幕右侧），平滑过渡 */
  setYaw(rad) { this._targetYaw = rad || 0; }

  setExpression(name) {
    const p = this.expressions[name] || this.expressions.neutral;
    this.expression = this.expressions[name] ? name : 'neutral';
    this.morphValues = { ...p.morphs };
    this._blushTarget = p.blush || 0;
    // 预设本身已经（半）闭眼时，再叠眨眼会很怪
    const m = p.morphs;
    this._exprNoBlink = Math.max(m[this.blinkMorph] || 0, m.E_Smile_L || 0, m.E_Smile_R || 0) >= 0.5;
  }

  /** 口型帧：{ open, wide, round } | { viseme } | null */
  setMouth(frame) { this._mouth = frame || null; }

  // 毛发卡片（Kuro "UseFurry" 材质）：alpha 柔化 + alpha-to-coverage。cfg: { material, fadeFrom, fadeTo }
  _setupFur(cfg) {
    if (!cfg) return;
    const rx = new RegExp(cfg.material || 'Tail');
    const lo = (cfg.fadeFrom ?? 0.03).toFixed(4);
    const hi = (cfg.fadeTo ?? 0.3).toFixed(4);
    this.root.traverse((o) => {
      if (!o.isMesh || !rx.test(o.material?.name || '')) return;
      const m = o.material;
      m.alphaTest = 0.01;
      m.transparent = false;
      m.alphaToCoverage = true;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <alphamap_fragment>',
          `#include <alphamap_fragment>
          diffuseColor.a = smoothstep(${lo}, ${hi}, diffuseColor.a);`);
      };
      m.customProgramCacheKey = () => `kuro-fur-${lo}-${hi}`;
      m.needsUpdate = true;
    });
  }

  // 脸部 shader 画腮红（模型没有 blush morph）。cfg: { material:'Face'(材质名正则), uv:[[u,v],[u,v]], radius:[rx,ry], color }
  _setupBlush(cfg = {}) {
    this._blush = { value: 0 };
    this._blushTarget = 0;
    const [l, r] = cfg.uv || [[0.29, 0.405], [0.71, 0.405]];
    const [rx, ry] = cfg.radius || [0.085, 0.045];
    const col = new THREE.Color(cfg.color || '#ff6f7d');
    const glsl = (v) => v.toFixed(4);
    const matRe = new RegExp(cfg.material || 'Face');
    this.root.traverse((o) => {
      if (!o.isMesh || !matRe.test(o.material?.name || '') || !o.material.map) return;
      const m = o.material;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uBlush = this._blush;
        sh.fragmentShader = 'uniform float uBlush;\n' + sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 r = vec2(${glsl(rx)}, ${glsl(ry)});
            vec2 a = (vMapUv - vec2(${glsl(l[0])}, ${glsl(l[1])})) / r;
            vec2 b = (vMapUv - vec2(${glsl(r[0])}, ${glsl(r[1])})) / r;
            float k = (exp(-dot(a, a) * 1.6) + exp(-dot(b, b) * 1.6)) * uBlush;
            vec3 tint = diffuseColor.rgb * vec3(${glsl(col.r)}, ${glsl(col.g)}, ${glsl(col.b)});
            diffuseColor.rgb = mix(diffuseColor.rgb, tint, clamp(k, 0.0, 1.0) * 0.55);
          }`);
      };
      m.customProgramCacheKey = () => 'face-blush';
      m.needsUpdate = true;
    });
  }

  _updateYaw(dt) {
    const cur = this.root.rotation.y;
    let d = this._targetYaw - cur;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.root.rotation.y = cur + d * Math.min(1, dt * 8);
  }

  // 口型叠在表情上：说话时把表情的嘴部 morph 压到 30%，让口型看得清
  _updateFace(dt) {
    const f = this._mouth;
    const rest = this.visemes.rest || {};
    let target = rest;
    if (f && f.viseme) {
      target = this.visemes[f.viseme] || rest;
    } else if (f && f.open != null) {
      target = mouthTargets(f, this.mouthMap);
    }
    const talking = !!f;
    for (const name of Object.keys(this.morphs)) {
      let base = this.morphValues[name] || 0;
      const isMouth = MOUTH_RE.test(name) || this._mouthNames.has(name);
      if (talking && isMouth) base *= 0.3;
      const sp = target[name] || 0;
      const goal = Math.max(base, sp);
      const cur = this.morphCurrent[name] || 0;
      const rate = sp > 0 || (talking && isMouth) ? 22 : 12; // 口型快、表情缓
      const next = cur + (goal - cur) * Math.min(1, dt * rate);
      this.morphCurrent[name] = next;
      for (const mesh of this.morphMeshes) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx !== undefined) mesh.morphTargetInfluences[idx] = next;
      }
    }
    this._blush.value += (this._blushTarget - this._blush.value) * Math.min(1, dt * 6);
  }

  _updateBlink(dt) {
    if (!this.autoBlink || this._exprNoBlink) return;
    const bm = this.blinkMorph;
    if (this.morphs[bm] === undefined) return;
    this._blinkTimer -= dt;
    if (this._blinkPhase < 0 && this._blinkTimer <= 0) this._blinkPhase = 0;
    if (this._blinkPhase < 0) return;
    this._blinkPhase += dt;
    const p = this._blinkPhase / 0.22;
    let w = 0;
    if (p < 0.5) w = p * 2;
    else if (p < 1) w = (1 - p) * 2;
    else { this._blinkPhase = -1; this._blinkTimer = 1.8 + Math.random() * 3.5; }
    const base = this.morphCurrent[bm] || 0;
    for (const mesh of this.morphMeshes) {
      const mi = mesh.morphTargetDictionary[bm];
      if (mi !== undefined) mesh.morphTargetInfluences[mi] = Math.max(base, w);
    }
  }

  update(dt) {
    // 先撤掉上一帧的程序化叠加（mixer 不保证每帧重写骨骼），倒序：弹簧最后叠加、最先还原
    this.springs.restore();
    if (this.gestureLayer) this.gestureLayer.restore();
    this.mixer.update(dt);
    this._updateYaw(dt);
    if (this.gestureLayer) this.gestureLayer.update(dt);
    this.springs.update(dt);
    this._updateFace(dt);
    this._updateBlink(dt);
  }
}

/** 释放一棵对象树的 geometry / material / texture / 骨骼纹理 */
export function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    }
  });
}
