// config.js — 默认配置 + 合并 + 素材包加载
//
// 一份 DeskPet 配置长这样（所有字段可选，缺省走默认）：
// {
//   pet: 'blue-whale' | { ...内联素材包 } | 'pets/xxx/pet.json'(url),
//   renderer: 'webm'|'gif'|'spritesheet'|'pixel'|'svg'|'three',  // 缺省取素材包声明
//   driver: 'chain'|'statemachine',                              // 缺省 chain
//   driverConfig: {...},        // 覆盖驱动参数
//   scene: 'desktop-corner' | {...},   // 布局（位置/尺寸/角落/可拖拽）
//   size: 300, corner:'bottom-right', margin:{x,y}, draggable:true,
//   ai: { enabled:false, eventMap:{}, intentMap:{}, llm:{complete} },
//   voice: { enabled:true, tts:provider, lang:'zh-CN', cooldownMs:8000 },
//   container: HTMLElement | selector,   // 挂载点，缺省 body
//   autoStart: true,
// }

// 绝对地址：以 / 或任意协议（http: blob: data: file: app: …）开头（与 voice/voice-pack.js 一致）
const ABS_RE = /^([a-z][a-z0-9+.-]*:|\/)/i;

export const DEFAULT_CONFIG = {
  renderer: null,          // null=用素材包 pet.json 里的 renderer
  driver: 'chain',
  driverConfig: {},
  scene: 'desktop-corner',
  size: 300,
  corner: 'bottom-right',
  margin: { x: 24, y: 0 },
  draggable: true,
  autoStart: true,
  ai: { enabled: false },
  voice: { enabled: true, cooldownMs: 8000, lang: 'zh-CN' },  // tts 可注入 provider（见 voice/tts.js）
};

/** 内置场景预设：布局与交互 */
export const SCENES = {
  'desktop-corner': { corner: 'bottom-right', margin: { x: 24, y: 0 }, draggable: true, follow: false },
  'desktop-free':   { corner: 'bottom-left', margin: { x: 24, y: 24 }, draggable: true, follow: false },
  'chat-inline':    { corner: 'bottom-right', margin: { x: 12, y: 12 }, draggable: false, follow: false },
  'fullscreen-center': { corner: 'center', margin: { x: 0, y: 0 }, draggable: false, follow: false },
};

export function mergeConfig(user = {}) {
  const scene = typeof user.scene === 'string' ? (SCENES[user.scene] || {}) : (user.scene || {});
  return {
    ...DEFAULT_CONFIG,
    ...user,
    corner: user.corner ?? scene.corner ?? DEFAULT_CONFIG.corner,
    margin: user.margin ?? scene.margin ?? DEFAULT_CONFIG.margin,
    draggable: user.draggable ?? scene.draggable ?? DEFAULT_CONFIG.draggable,
    ai: { ...DEFAULT_CONFIG.ai, ...(user.ai || {}) },
    voice: { ...DEFAULT_CONFIG.voice, ...(user.voice || {}) },
    _scene: scene,
  };
}

/**
 * 加载素材包：支持三种形式
 *   1) 内联对象（已含 renderer/actions/...）
 *   2) pet.json 的 url 字符串
 *   3) 约定路径名（相对 petsBaseUrl，如 'blue-whale' → petsBaseUrl+'blue-whale/pet.json'）
 * 返回规范化的 assetpack：{ id, renderer, assets, chain, stateActions, meta }
 */
export async function loadAssetPack(pet, petsBaseUrl = 'pets/') {
  let manifest, baseDir;
  if (pet && typeof pet === 'object' && !pet.url) {
    manifest = pet;
    baseDir = pet.baseUrl || '';
  } else {
    const url = typeof pet === 'string' && pet.endsWith('.json')
      ? pet
      : petsBaseUrl + pet + '/pet.json';
    const res = await fetch(url);
    if (!res.ok) throw new Error('load pet.json failed: ' + url + ' HTTP ' + res.status);
    manifest = await res.json();
    baseDir = url.slice(0, url.lastIndexOf('/') + 1);
  }

  // assets.baseUrl：素材文件相对 pet.json 的目录（默认 pet.json 同级 assets/）
  const assets = { ...(manifest.assets || {}) };
  if (assets.baseUrl == null) assets.baseUrl = baseDir + (manifest.assetsDir || 'assets/');
  else if (!/^https?:|^\//.test(assets.baseUrl)) assets.baseUrl = baseDir + assets.baseUrl;
  // 透传渲染几何/网格/调色板等
  for (const k of ['geometry', 'grid', 'sheet', 'palette', 'frames', 'colors', 'model', 'frameMs', 'autoSpin', 'fps',
    'camera', 'turnDeg', 'shadow', 'expressions', 'blush', 'fur', 'springBones', 'gestureBones', 'aspect']) {
    if (manifest[k] != null && assets[k] == null) assets[k] = manifest[k];
  }
  if (assets.actions == null) assets.actions = manifest.actions || {};

  // 预录语音包 index.json：相对 assetsDir（与其它素材一致）
  let voices = null;
  if (manifest.voices != null && manifest.voices !== '') {
    if (typeof manifest.voices !== 'string') console.warn('[pet] manifest.voices 应为字符串 URL，已忽略:', manifest.voices);
    else voices = ABS_RE.test(manifest.voices) ? manifest.voices : assets.baseUrl + manifest.voices;
  }

  return {
    id: manifest.id || 'pet',
    renderer: manifest.renderer || 'webm',
    assets,
    chain: manifest.chain || null,          // 概率链池配置（chain 驱动用）
    stateActions: manifest.stateActions || null, // 状态→动作（statemachine 驱动用）
    intentMap: manifest.intentMap || null,  // 意图→动作（AI 用）
    emotes: manifest.emotes || null,        // 表情特写弹层（半身近景，独立于本体）
    walk: manifest.walk || null,            // 走动位移：{ left, right, speed(px/s), margin(px) }
    voices,                                 // 预录语音包 URL（voice/voice-pack.js）
    fps: manifest.fps || null,              // 帧率（webm 渲染器用于把 action 的 from/to 帧号换算成秒）
    meta: manifest.meta || {},
  };
}
