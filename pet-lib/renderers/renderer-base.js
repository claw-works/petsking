// renderer-base.js — 渲染器统一接口
//
// 所有渲染器（webm/gif/spritesheet/pixel/svg/three/gltf 共七种）都实现同一套接口，
// 这样 DeskPet 主类可以无差别地组合任意渲染器 + 任意驱动 + 任意素材包。
//
// 渲染器只负责「把某个动作画出来」，不关心动作是怎么选的（那是 Driver 的事）。

/**
 * @typedef {Object} RendererContext
 * @property {HTMLElement} container  挂载容器
 * @property {Object} assets          素材包解析结果（见 AssetPack）
 * @property {Object} [options]       渲染器专属选项
 */

/** 渲染器抽象基类：子类必须实现 mount / play / destroy */
export class RendererBase {
  constructor(ctx) {
    this.container = ctx.container;
    this.assets = ctx.assets;
    this.options = ctx.options || {};
    this.facing = 'front'; // 'front' | 'left' | 'right'
    this.currentAction = null;
    this._onEnded = null; // 非循环动作播完的回调（供 Driver 接链）
  }

  /** 挂载 DOM/canvas/webgl，返回 Promise（异步资源就绪后 resolve） */
  async mount() { throw new Error('renderer.mount() not implemented'); }

  /**
   * 播放一个动作。
   * @param {string} action  动作名（素材包里定义的）
   * @param {Object} meta     { loop?:bool, kind?:string }
   */
  play(action, meta) { throw new Error('renderer.play() not implemented'); }

  /** 设置朝向（front/left/right）。位图渲染器多用 scaleX(-1) 镜像 */
  setFacing(dir) { this.facing = dir; }

  /** 注册「非循环动作播完」回调 */
  onEnded(cb) { this._onEnded = cb; }

  /** 该渲染器支持的动作名列表（默认取素材包声明的） */
  listActions() { return this.assets.actions ? Object.keys(this.assets.actions) : []; }

  // —— 可选能力（基类空实现；不支持的渲染器调用时静默忽略）——

  /** 支持哪些能力：playground 据此显示面板，DeskPet 据此决定是否调用 */
  // 子类用 getter 覆写（get capabilities() {...}），不要用赋值字段
  get capabilities() { return { expression: false, mouth: false, gesture: false }; }

  /** 切表情预设；未知名字回落 neutral */
  setExpression(_name) {}
  /** [{ id, label }] */
  listExpressions() { return []; }

  /** 口型帧：{ open, wide, round }（音频分析）| { viseme }（按字估算）| null（闭嘴） */
  setMouth(_frame) {}

  /** 程序化头部 / 上身小动作；null 清除 */
  setGesture(_name) {}
  /** 手势名列表 */
  listGestures() { return []; }

  /** 卸载、释放资源 */
  destroy() { throw new Error('renderer.destroy() not implemented'); }
}

/** 渲染器注册表：type → 类。renderers/index.js 填充 */
export const RENDERERS = {};
export function registerRenderer(type, cls) { RENDERERS[type] = cls; }
export function createRenderer(type, ctx) {
  const Cls = RENDERERS[type];
  if (!Cls) throw new Error('unknown renderer type: ' + type);
  return new Cls(ctx);
}
