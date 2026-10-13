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
//   pet.setExpression(name) / pet.setGesture(name|null)   表情 / 头部小动作（渲染器支持时）
//   pet.voice(lineId) / pet.speak(text) / pet.stopSpeak()  预录台词 / 任意文字（TTS），带口型
//   pet.perform(perf)               执行一个表演对象 { action, expression, gesture, voice, say }
//   pet.on('speech', cb)            { phase:'start'|'end', text, lineId? }
//   pet.on(event, cb)               'action' | 'state' | 'click' | 'drag'
//   pet.setFacing(dir) / pet.setPosition(x,y)

import { createRenderer } from './renderers/renderer-base.js';
import { createDriver } from './core/driver-base.js';
import { mergeConfig, loadAssetPack } from './config.js';
import { AgentBridge } from './ai/agent-bridge.js';
import { Voice } from './voice/voice.js';
import { loadVoicePack } from './voice/voice-pack.js';

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
.petlib-bubble::after{content:'';position:absolute;bottom:-5px;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#fff;border-bottom:0}
.petlib-emote{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;transition:opacity .3s ease;pointer-events:none}
.petlib-emote.show{opacity:1}
.petlib-emote video{width:100%;height:100%;object-fit:contain}
.petlib-stage.emoting{transition:opacity .2s ease}`;
  const tag = document.createElement('style'); tag.dataset.petlib = '1'; tag.textContent = css;
  document.head.appendChild(tag);
}

export class DeskPet {
  constructor(config, pack) {
    this.config = config;
    this.pack = pack;
    this.listeners = { action: [], state: [], click: [], drag: [], speech: [] };
    this._expression = 'neutral';
    this._destroyed = false;
    this.facing = 'front';
    this._built = false;
    this._emoteToken = 0;
  }

  // —— 生命周期 ——
  async init() {
    injectStyle();
    this._buildDom();
    // 渲染器
    const rendererType = this.config.renderer || this.pack.renderer;
    this.renderer = createRenderer(rendererType, { container: this.stage, assets: this.pack.assets });
    await this.renderer.mount();
    if (this._destroyed) return this; // 挂载期间已销毁：不再创建驱动 / 语音
    this._initVoice();
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

  _initVoice() {
    const vc = this.config.voice || {};
    this.voiceEnabled = vc.enabled !== false;
    this._voiceCooldownMs = vc.cooldownMs ?? 8000;
    this._lastAutoVoiceAt = 0;
    this.voiceEngine = new Voice({ setMouth: (f) => this.renderer && this.renderer.setMouth(f), tts: vc.tts, lang: vc.lang });
    this._voicePackP = this.pack.voices
      ? loadVoicePack(this.pack.voices).catch((e) => { console.warn('[pet] voice pack', e); return null; })
      : Promise.resolve(null);
    // 浏览器自动播放策略：第一次用户手势时唤醒 AudioContext
    this._unlockAudio = () => this.voiceEngine.unlock();
    document.addEventListener('pointerdown', this._unlockAudio, { once: true, capture: true });
  }

  _buildDom() {
    const root = document.createElement('div');
    root.className = 'petlib-root';
    root.dataset.corner = this.config.corner;
    const stage = document.createElement('div');
    stage.className = 'petlib-stage';
    const bubble = document.createElement('div');
    bubble.className = 'petlib-bubble';
    const emote = document.createElement('div');
    emote.className = 'petlib-emote';
    stage.appendChild(emote);
    root.appendChild(stage); root.appendChild(bubble);

    // 尺寸：由素材包 geometry.aspect 决定高度（webm），否则按 1:1 或声明
    const aspect = (this.pack.assets.geometry && this.pack.assets.geometry.aspect) || this.pack.assets.aspect || 1;
    root.style.setProperty('--pl-size', this.config.size + 'px');
    root.style.setProperty('--pl-h', (this.config.size / aspect) + 'px');
    root.style.setProperty('--pl-mx', this.config.margin.x + 'px');
    root.style.setProperty('--pl-my', this.config.margin.y + 'px');

    const container = this._resolveContainer();
    container.appendChild(root);
    this.root = root; this.stage = stage; this.bubble = bubble; this.emoteLayer = emote;

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
    if (type === 'statemachine') dc = { stateActions: this.pack.stateActions || {}, chain: this.pack.chain || null, ...dc };
    this.driver = createDriver(type, dc);
    this.driver.onAction((action, meta) => this._onDriverAction(action, meta));
  }

  /** 驱动输出：播动作 + 走动 + 状态表情/手势 + 状态语音 */
  _onDriverAction(action, meta = {}) {
    this.renderer.play(action, meta);
    this._applyMove(action);
    this._applyLook(meta);
    if (meta.voice) this.voice(meta.voice, { auto: true, expression: meta.expression });
    this._emit('action', { action, meta });
    if (meta.kind) this._emit('state', { state: meta.kind, action });
  }

  /** 状态带表情/手势就切过去；从带表情的状态离开时恢复 neutral，不残留 */
  _applyLook(meta) {
    if (meta.expression || meta.gesture) {
      clearTimeout(this._lookT);
      if (meta.expression) this.setExpression(meta.expression);
      this.setGesture(meta.gesture || null);
      this._stateLook = true;
    } else if (this._stateLook) {
      this._stateLook = false;
      this.setExpression('neutral');
      this.setGesture(null);
    }
  }

  /** 换渲染器后把当前表情同步过去（口型由 Voice 闭包读 this.renderer，自动跟随新渲染器） */
  _syncRendererLook() {
    if (this.renderer) this.renderer.setExpression(this._expression);
  }

  /** 根据当前动作决定是否让宠物水平位移（走动时同步平移整个容器）。 */
  _applyMove(action) {
    const walk = this.pack.walk;
    if (!walk) return;
    let dir = null;
    if (action === walk.left) dir = -1;
    else if (action === walk.right) dir = 1;
    if (dir === null) { this._stopMove(); return; }
    this._startMove(dir, walk, action);
  }

  _startMove(dir, walk, action) {
    this._stopMove();
    // 3D 渲染器能按 clip 真实步速换算像素速度（脚不打滑）；否则用素材包配置
    const fromRenderer = this.renderer && this.renderer.getWalkSpeedPx ? this.renderer.getWalkSpeedPx(action) : null;
    const speed = fromRenderer || walk.speed || 60;      // px/秒
    const margin = walk.margin ?? 20;    // 距视口边缘安全距
    // 把当前基于 corner 的定位换算成绝对 left/top，之后用 left 平移
    const r = this.root.getBoundingClientRect();
    let x = r.left, y = r.top;
    this.root.style.left = x + 'px'; this.root.style.top = y + 'px';
    this.root.style.right = 'auto'; this.root.style.bottom = 'auto'; this.root.style.transform = 'none';
    const w = r.width;
    const maxX = window.innerWidth - w - margin;
    const minX = margin;
    let last = performance.now();
    const step = (now) => {
      const dt = (now - last) / 1000; last = now;
      x += dir * speed * dt;
      // 到边界：贴边并停止本次位移（下次掷骰会换动作/方向）
      if (x <= minX) { x = minX; this.root.style.left = x + 'px'; this._moveRaf = null; return; }
      if (x >= maxX) { x = maxX; this.root.style.left = x + 'px'; this._moveRaf = null; return; }
      this.root.style.left = x + 'px';
      this._moveRaf = requestAnimationFrame(step);
    };
    this._moveRaf = requestAnimationFrame(step);
  }

  _stopMove() {
    if (this._moveRaf) { cancelAnimationFrame(this._moveRaf); this._moveRaf = null; }
  }

  start() { if (this.driver) this.driver.start(); return this; }
  stop() { if (this.driver) this.driver.stop(); return this; }

  destroy() {
    this._emoteToken++;
    clearTimeout(this._emoteT);
    this._destroyed = true;
    this._stopMove();
    clearTimeout(this._lookT);
    clearTimeout(this._exprRestoreT);
    if (this.voiceEngine) this.voiceEngine.stop();
    if (this._unlockAudio) document.removeEventListener('pointerdown', this._unlockAudio, { capture: true });
    if (this.driver) this.driver.stop();
    if (this.renderer) this.renderer.destroy();
    if (this.bridge) this.bridge.unbindAll();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }

  // —— 驱动函数（对外）——
  play(action, meta) { if (this.renderer) this.renderer.play(action, meta || { loop: false }); this._emit('action', { action, meta }); return this; }
  feed(ev) { if (this.driver && this.driver.feed) this.driver.feed(ev); return this; }
  react(intent, opts) { if (this.bridge) return this.bridge.reactTo(intent, opts); this.play(intent, { loop: false }); }
  clickAction() { if (this.driver && this.driver.click) this.driver.click(); }

  setDriver(type, config) { this._makeDriver(type, config); this.start(); return this; }

  async setRenderer(type) {
    if (this.renderer) this.renderer.destroy();
    this.renderer = createRenderer(type, { container: this.stage, assets: this.pack.assets });
    await this.renderer.mount();
    this.driver.onAction((action, meta) => this._onDriverAction(action, meta));
    this._syncRendererLook();
    if (this.driver.current) this.renderer.play(this.driver.current, { loop: true });
    return this;
  }

  /**
   * 执行表演对象（意图反应用）：一次性动作 + 表情/手势保持 holdMs（默认 3s）后恢复 + 语音或气泡。
   * opts.silent：跳过语音（例如聊天随后会朗读整段回复）。
   */
  perform(perf, { kind, silent = false } = {}) {
    if (!perf) return this;
    if (perf.action) this.play(perf.action, { loop: false, kind });
    if (perf.expression || perf.gesture) {
      if (perf.expression) this.setExpression(perf.expression);
      if (perf.gesture) this.setGesture(perf.gesture);
      clearTimeout(this._lookT);
      this._lookT = setTimeout(() => { this.setExpression('neutral'); this.setGesture(null); }, perf.holdMs ?? 3000);
    }
    if (perf.voice && !silent) this.voice(perf.voice, { auto: true, expression: perf.expression });
    else if (perf.say) this.say(perf.say);
    return this;
  }

  setExpression(name) { this._expression = name || 'neutral'; if (this.renderer) this.renderer.setExpression(this._expression); return this; }
  setGesture(name) { if (this.renderer) this.renderer.setGesture(name || null); return this; }

  /** 预录语音包（Promise<VoicePack|null>） */
  voicePack() { return this._voicePackP || Promise.resolve(null); }

  /**
   * 播预录台词：音频（口型）+ 气泡 + 台词表情（说完 0.7s 恢复）。
   * opts.auto：状态机 / 意图自动触发，受 cooldownMs 限制；手动调用不受限。
   */
  async voice(lineId, { expression, auto = false } = {}) {
    const pack = await this.voicePack();
    const line = pack && pack.get(lineId);
    if (!line) { console.warn('[pet] unknown voice line:', lineId); return { played: false, reason: 'unknown-line' }; }
    const src = pack.url(line);
    if (!src) { console.warn('[pet] voice line has no audio url:', lineId); return { played: false, reason: 'no-src' }; }
    if (auto && this.voiceEngine.unlocked) {
      const now = Date.now();
      if (now - this._lastAutoVoiceAt < this._voiceCooldownMs) return { played: false, reason: 'cooldown' };
      this._lastAutoVoiceAt = now;
    }
    return this._talk(line.text, () => this.voiceEngine.playAudio(src), { expression: expression || line.expression, lineId });
  }

  /** 任意文字说话：TTS provider 出声（有音频则音频口型，否则按字估算）+ 气泡 */
  speak(text, { expression } = {}) {
    return this._talk(text, () => this.voiceEngine.speakText(text), { expression });
  }

  stopSpeak() { if (this.voiceEngine) this.voiceEngine.stop(); return this; }

  async _talk(text, run, { expression, lineId } = {}) {
    if (text) this.say(text, Math.max(2600, text.length * 220));
    if (!this.voiceEnabled) return { played: false, reason: 'disabled' };
    const prev = this._expression;
    if (expression) this.setExpression(expression);
    this._emit('speech', { phase: 'start', text, lineId });
    const res = await run();
    this._emit('speech', { phase: 'end', text, lineId, ...res });
    if (expression) {
      clearTimeout(this._exprRestoreT);
      this._exprRestoreT = setTimeout(() => { if (this._expression === expression) this.setExpression(prev); }, 700);
    }
    return res;
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

  /**
   * 播一个表情特写（半身近景弹层），不影响本体动作。
   * @param action 表情动作名。文件从 pack.emotes.actions[action] 取，
   *               相对 pack.emotes.baseUrl（缺省用 assets.baseUrl）。
   * @param opts.ms 兜底自动关闭毫秒（默认 4000），非循环视频优先按 ended 关闭。
   */
  emote(action, opts = {}) {
    if (!this.emoteLayer) return this;
    const emotes = this.pack.emotes || {};
    const file = (emotes.actions && emotes.actions[action]);
    if (!file) { this._emit('action', { action, meta: { emote: true, missing: true } }); return this; }
    const base = emotes.baseUrl || this.pack.assets.baseUrl || '';
    const token = ++this._emoteToken;

    // 隐藏本体（stage 里的动作 video），让特写盖满同一位置
    const bodyVids = [...this.stage.querySelectorAll('video')].filter((el) => !this.emoteLayer.contains(el));
    const hideBody = () => bodyVids.forEach((el) => { el.dataset.emoteHidden = el.style.opacity; el.style.opacity = '0'; });
    const showBody = () => bodyVids.forEach((el) => { if (el.dataset.emoteHidden != null) { el.style.opacity = el.dataset.emoteHidden; delete el.dataset.emoteHidden; } });

    const FADE = 0.35; // 结尾提前淡出的秒数
    let closing = false;

    const finish = () => {
      if (token !== this._emoteToken) return;
      if (this.driver && this.driver.start) this.driver.start();  // 恢复本体驱动
      this.emoteLayer.innerHTML = '';
    };
    // 开始淡出：特写层淡出的同时把本体淡回，两者交叉过渡，末尾更柔和
    const beginClose = () => {
      if (closing || token !== this._emoteToken) return;
      closing = true;
      this.emoteLayer.classList.remove('show');  // 触发 .3s opacity 淡出
      showBody();                                 // 本体同时淡回（webm 本体有自己的 opacity 过渡）
      setTimeout(finish, 320);                    // 等淡出过渡走完再清理
    };

    this.emoteLayer.innerHTML = '';
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = false;
    v.src = base + encodeURIComponent(file);
    this.emoteLayer.appendChild(v);

    v.addEventListener('loadeddata', () => {
      if (token !== this._emoteToken) return;
      if (this.driver && this.driver.stop) this.driver.stop();  // 暂停本体驱动，避免它在特写期间切动作把本体显出来
      hideBody();
      this.emoteLayer.classList.add('show');
      v.play().catch(() => {});
    });
    // 结尾前 FADE 秒就开始淡出（而不是等整段播完才切），过渡更平滑
    v.addEventListener('timeupdate', () => {
      if (!closing && isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - FADE) beginClose();
    });
    v.addEventListener('ended', beginClose);      // 兜底：万一没触发 timeupdate
    clearTimeout(this._emoteT);
    this._emoteT = setTimeout(beginClose, opts.ms || 4000);  // 兜底：视频异常不结束
    this._emit('action', { action, meta: { emote: true } });
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
      if (!d.moved) this._startDragAnim();
      d.moved = true; st.classList.add('dragging');
      this.setPosition(e.clientX - d.offX, e.clientY - d.offY);
    });
    const up = () => {
      if (!d) return;
      if (d.moved) {
        this._justDragged = true; setTimeout(() => (this._justDragged = false), 120);
        this._emit('drag', {});
        this._endDragAnim();
      }
      st.classList.remove('dragging'); d = null;
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);
  }

  /** 拖拽开始：若素材包有 drag 动作，暂停驱动并循环播放 drag。 */
  _startDragAnim() {
    const hasDrag = this.pack.assets && this.pack.assets.actions && this.pack.assets.actions.drag;
    if (!hasDrag || this._dragging) return;
    this._dragging = true;
    this._stopMove();
    if (this.driver && this.driver.stop) this.driver.stop();
    this.play('drag', { loop: true });
  }

  /** 拖拽结束：恢复驱动，回到 idle/概率链。 */
  _endDragAnim() {
    if (!this._dragging) return;
    this._dragging = false;
    if (this.driver && this.driver.start) this.driver.start();
  }
}
