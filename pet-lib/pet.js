// pet.js — DeskPet 主类：组合 driver + renderer + assetpack，对外总入口。
//
// 职责：建根容器 + 布局（角落/尺寸/可拖拽）→ 挂渲染器 → 接驱动 →
// 驱动输出的动作交给渲染器播 → 处理点击/拖拽 → 暴露驱动函数与事件。
//
// 对外 API（也见 index.js 的 createPet）：
//   pet.start() / pet.stop() / pet.destroy()
//   pet.play(action, meta)          手动播一个动作
//   pet.setDriver(type, config)     运行时切驱动（chain ↔ statemachine）
//   pet.setRenderer(type)           运行时切渲染器（需素材包支持）
//   pet.feed(agentEvent)            喂 Agent 事件（statemachine 驱动）
//   pet.react(intent)               意图/情绪表演（需 AI bridge）
//   pet.say(text)                   冒泡说话
//   pet.on(event, cb)               'action' | 'state' | 'click' | 'drag'
//   pet.setFacing(dir) / pet.setPosition(x,y)

import { createRenderer } from './renderers/renderer-base.js';
import { createDriver } from './core/driver-base.js';
import { mergeConfig, loadAssetPack } from './config.js';
import { AgentBridge } from './ai/agent-bridge.js';

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return; styleInjected = true;
  const css = `
.petlib-root{position:fixed;z-index:40;user-select:none;pointer-events:none}
.petlib-root[data-corner="bottom-right"]{right:var(--pl-mx,24px);bottom:var(--pl-my,0)}
.petlib-root[data-corner="bottom-left"]{left:var(--pl-mx,24px);bottom:var(--pl-my,0)}
.petlib-root[data-corner="top-right"]{right:var(--pl-mx,24px);top:var(--pl-my,0)}
.petlib-root[data-corner="top-left"]{left:var(--pl-mx,24px);top:var(--pl-my,0)}
.petlib-root[data-corner="center"]{left:50%;top:50%;transform:translate(-50%,-50%)}
.petlib-stage{position:relative;width:var(--pl-size,300px);height:var(--pl-h,300px);pointer-events:auto;cursor:grab}
.petlib-stage.dragging{cursor:grabbing}
.petlib-bubble{position:absolute;left:50%;top:-6px;transform:translate(-50%,-100%);background:#fff;color:#222;font-size:12px;padding:6px 10px;border-radius:10px;white-space:nowrap;opacity:0;transition:opacity .2s;pointer-events:none;font-family:-apple-system,"PingFang SC",sans-serif}
.petlib-bubble.show{opacity:1}
.petlib-bubble::after{content:'';position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#fff;border-bottom:0}`;
  const tag = document.createElement('style'); tag.dataset.petlib = '1'; tag.textContent = css;
  document.head.appendChild(tag);
}

export class DeskPet {
  constructor(config, pack) {
    this.config = config;
    this.pack = pack;
    this.listeners = { action: [], state: [], click: [], drag: [] };
    this.facing = 'front';
    this._built = false;
  }

  // —— 生命周期 ——
  async init() {
    injectStyle();
    this._buildDom();
    // 渲染器
    const rendererType = this.config.renderer || this.pack.renderer;
    this.renderer = createRenderer(rendererType, { container: this.stage, assets: this.pack.assets });
    await this.renderer.mount();
    // 驱动
    this._makeDriver(this.config.driver, this.config.driverConfig);
    // AI bridge
    if (this.config.ai && this.config.ai.enabled) {
      this.bridge = new AgentBridge(this, { eventMap: this.config.ai.eventMap, intentMap: { ...(this.pack.intentMap || {}), ...(this.config.ai.intentMap || {}) } });
    }
    this._built = true;
    if (this.config.autoStart) this.start();
    return this;
  }

  _buildDom() {
    const root = document.createElement('div');
    root.className = 'petlib-root';
    root.dataset.corner = this.config.corner;
    const stage = document.createElement('div');
    stage.className = 'petlib-stage';
    const bubble = document.createElement('div');
    bubble.className = 'petlib-bubble';
    root.appendChild(stage); root.appendChild(bubble);

    // 尺寸：由素材包 geometry.aspect 决定高度（webm），否则按 1:1 或声明
    const aspect = (this.pack.assets.geometry && this.pack.assets.geometry.aspect) || this.pack.assets.aspect || 1;
    root.style.setProperty('--pl-size', this.config.size + 'px');
    root.style.setProperty('--pl-h', (this.config.size / aspect) + 'px');
    root.style.setProperty('--pl-mx', this.config.margin.x + 'px');
    root.style.setProperty('--pl-my', this.config.margin.y + 'px');

    const container = this._resolveContainer();
    container.appendChild(root);
    this.root = root; this.stage = stage; this.bubble = bubble;

    if (this.config.draggable) this._bindDrag();
    this._bindClick();
  }

  _resolveContainer() {
    const c = this.config.container;
    if (!c) return document.body;
    if (typeof c === 'string') return document.querySelector(c) || document.body;
    return c;
  }

  _makeDriver(type, extraConfig) {
    if (this.driver) this.driver.stop();
    // 组装驱动配置：素材包提供池/映射，用户 driverConfig 覆盖
    let dc = { ...(extraConfig || {}) };
    if (type === 'chain') dc = { ...(this.pack.chain || {}), ...dc };
    if (type === 'statemachine') dc = { stateActions: this.pack.stateActions || {}, ...dc };
    this.driver = createDriver(type, dc);
    this.driver.onAction((action, meta) => {
      this.renderer.play(action, meta);
      this._emit('action', { action, meta });
      if (meta && meta.kind) this._emit('state', { state: meta.kind, action });
    });
  }

  start() { if (this.driver) this.driver.start(); return this; }
  stop() { if (this.driver) this.driver.stop(); return this; }

  destroy() {
    if (this.driver) this.driver.stop();
    if (this.renderer) this.renderer.destroy();
    if (this.bridge) this.bridge.unbindAll();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }

  // —— 驱动函数（对外）——
  play(action, meta) { if (this.renderer) this.renderer.play(action, meta || { loop: false }); this._emit('action', { action, meta }); return this; }
  feed(ev) { if (this.driver && this.driver.feed) this.driver.feed(ev); return this; }
  react(intent) { if (this.bridge) return this.bridge.reactTo(intent); this.play(intent, { loop: false }); }
  clickAction() { if (this.driver && this.driver.click) this.driver.click(); }

  setDriver(type, config) { this._makeDriver(type, config); this.start(); return this; }

  async setRenderer(type) {
    if (this.renderer) this.renderer.destroy();
    this.renderer = createRenderer(type, { container: this.stage, assets: this.pack.assets });
    await this.renderer.mount();
    this.driver.onAction((action, meta) => { this.renderer.play(action, meta); this._emit('action', { action, meta }); });
    if (this.driver.current) this.renderer.play(this.driver.current, { loop: true });
    return this;
  }

  setFacing(dir) { this.facing = dir; if (this.renderer) this.renderer.setFacing(dir); return this; }

  setPosition(x, y) {
    this.root.style.left = x + 'px'; this.root.style.top = y + 'px';
    this.root.style.right = 'auto'; this.root.style.bottom = 'auto'; this.root.style.transform = 'none';
    return this;
  }

  /** 运行时改宠物大小（px 宽度）。高度按素材包 aspect 自动算。 */
  setSize(px) {
    this.config.size = px;
    const aspect = (this.pack.assets.geometry && this.pack.assets.geometry.aspect) || this.pack.assets.aspect || 1;
    this.root.style.setProperty('--pl-size', px + 'px');
    this.root.style.setProperty('--pl-h', (px / aspect) + 'px');
    return this;
  }

  say(text, ms = 2600) {
    if (!this.bubble) return;
    this.bubble.textContent = text; this.bubble.classList.add('show');
    clearTimeout(this._bubbleT);
    this._bubbleT = setTimeout(() => this.bubble.classList.remove('show'), ms);
    return this;
  }

  // —— 事件 ——
  on(event, cb) { if (this.listeners[event]) this.listeners[event].push(cb); return this; }
  _emit(event, payload) { (this.listeners[event] || []).forEach((cb) => cb(payload)); }

  // —— 交互 ——
  _bindClick() {
    this.stage.addEventListener('click', () => {
      if (this._justDragged) return;
      this._emit('click', {});
      this.clickAction();
    });
  }

  _bindDrag() {
    const st = this.stage;
    let d = null;
    st.addEventListener('pointerdown', (e) => {
      const r = this.root.getBoundingClientRect();
      d = { sx: e.clientX, sy: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moved: false };
      st.setPointerCapture(e.pointerId);
    });
    st.addEventListener('pointermove', (e) => {
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      d.moved = true; st.classList.add('dragging');
      this.setPosition(e.clientX - d.offX, e.clientY - d.offY);
    });
    const up = () => {
      if (!d) return;
      if (d.moved) { this._justDragged = true; setTimeout(() => (this._justDragged = false), 120); this._emit('drag', {}); }
      st.classList.remove('dragging'); d = null;
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
  }
}
