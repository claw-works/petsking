// webm.js — 透明 VP9-alpha webm 渲染器（双 <video> 交叉淡入 + 脚线对齐）
//
// 素材包契约：assets.actions[action] 可以是
//   - 字符串："文件名"                （整段播放）
//   - 对象：  { file, from, to, loop, loopFrom, loopTo, exit, speed, flipX, flipY }
//       file            相对 assets.baseUrl 的文件名（多个 action 可指同一文件 = 复用素材）
//       from            播放起始帧（默认 0）
//       to              播放结束帧；不填或 -1 = 视频末尾。from/to 是「播放硬边界」
//       loop            是否循环（默认跟随 meta.loop）
//       loopFrom        循环回跳帧（默认 = from）。首播含 [from, loopFrom] 的入场/前摇
//       loopTo          循环终点帧（默认 = to）。循环阶段在 [loopFrom, loopTo] 反复，到点回跳 loopFrom
//       exit            true 时：被切走前先把 [当前, to] 收尾段播完再切（默认 false = 硬切）
//       speed           播放速度（默认 1；0.5 慢放，2 快放）
//       flipX / flipY   左右 / 上下镜像（默认 false）
//   assets.fps          帧率（默认 24），把帧号换算成秒
//   assets.geometry     { feetRatio, aspect } 决定脚线对齐与画幅比例
//
// 三段结构：[from→loopFrom 入场] [loopFrom↔loopTo 循环] [loopTo→to 收尾(exit)]
// 参数解析不写死：新增参数只需在 _resolve/play 里加一处处理。

import { RendererBase, registerRenderer } from './renderer-base.js';

export class WebmRenderer extends RendererBase {
  async mount() {
    const geo = this.assets.geometry || {};
    this.feetRatio = geo.feetRatio ?? 0.9167; // 脚线占画面高度比例
    this.aspect = geo.aspect ?? (16 / 9);
    this.baseUrl = this.assets.baseUrl || '';
    this.fps = this.assets.fps || 24;

    const stage = document.createElement('div');
    stage.className = 'petlib-webm-stage';
    stage.style.cssText = 'position:relative;width:100%;height:100%;';

    const a = document.createElement('video');
    const b = document.createElement('video');
    for (const v of [a, b]) {
      v.muted = true; v.playsInline = true; v.autoplay = true;
      v.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
        'opacity:0;transition:opacity .18s ease;transform-origin:center bottom;';
    }
    a.style.opacity = '1';
    stage.appendChild(a); stage.appendChild(b);
    this.container.appendChild(stage);

    this.stage = stage; this.videoA = a; this.videoB = b;
    this.frontIndex = 0; this.gen = 0;
    this._frontFlipX = false; this._frontFlipY = false;
    this._cur = null;          // 当前动作的规范化定义（用于 exit 收尾判断）
    this._exiting = false;     // 是否正在播收尾段
    this._pending = null;      // 收尾期间暂存的下一个 play 请求
  }

  /** 规范化 action 定义，并对循环区间做 clamp / 非法退化 */
  _resolve(action, meta) {
    const raw = this.assets.actions[action];
    if (raw == null) return null;
    const def = typeof raw === 'string' ? { file: raw } : raw;
    const from = def.from || 0;
    const to = (def.to == null || def.to < 0) ? null : def.to; // null = 末尾
    // 循环区间默认 = 播放区间；clamp 进 [from, to]
    let loopFrom = def.loopFrom != null ? def.loopFrom : from;
    let loopTo = def.loopTo != null ? def.loopTo : to;
    if (loopFrom < from) loopFrom = from;
    if (to != null && loopTo != null && loopTo > to) loopTo = to;
    // loopFrom == loopTo → 定格静止帧；loopFrom > loopTo（区间反了）→ 退化成播放区间循环
    let still = false;
    if (loopTo != null && loopFrom === loopTo) { still = true; }
    else if (loopTo != null && loopFrom > loopTo) { loopFrom = from; loopTo = to; }
    return {
      action, file: def.file, from, to, loopFrom, loopTo, still,
      loop: def.loop != null ? def.loop : (meta.loop !== false),
      exit: !!def.exit,
      speed: def.speed || 1,
      flipX: !!def.flipX, flipY: !!def.flipY,
    };
  }

  _composeTransform(flipX, flipY) {
    const mirrored = (this.facing === 'right') !== flipX; // XOR
    const sx = mirrored ? -1 : 1;
    const sy = flipY ? -1 : 1;
    return (sx === 1 && sy === 1) ? '' : `scaleX(${sx}) scaleY(${sy})`;
  }

  play(action, meta = {}) {
    const d = this._resolve(action, meta);
    if (!d || !d.file) return;

    // 若当前动作配了 exit 且正在循环 → 先播收尾段（当前→to），收尾结束后再切到新动作
    if (this._cur && this._cur.exit && !this._exiting && this._cur.action !== action) {
      this._pending = { action, meta };
      this._playExit();
      return;
    }
    this._start(d, meta);
  }

  /** 真正开始播一个（已规范化的）动作 */
  _start(d, meta) {
    this.currentAction = d.action;
    this._cur = d;
    this._exiting = false;
    const gen = ++this.gen;
    const el = this.frontIndex === 0 ? this.videoB : this.videoA;
    const fromSec = d.from / this.fps;
    const loopFromSec = d.loopFrom / this.fps;
    const loopToSec = d.loopTo != null ? d.loopTo / this.fps : null;

    el.src = this.baseUrl + encodeURIComponent(d.file);
    el.loop = false;
    el.onended = null; el.ontimeupdate = null;

    // rAF 逐帧轮询 currentTime 检测循环终点，比 ontimeupdate（浏览器约 250ms 才触发一次）精度高一个量级，
    // 避免回跳判定滞后导致「loopTo 多播了几帧」。每次回跳后要重新调度，否则只循环一次。
    //
    // 竞态注意：el.currentTime = loopFromSec 是异步 seek，不会立刻生效。如果回跳后立刻又用 rAF
    // 轮询 currentTime，很可能读到 seek 完成前的旧值（仍 ≥ loopToSec），导致 atLoopEnd 被连续
    // 重复触发、反复重新 seek/play，最终停在不可预测的位置。用 seeking 标记 + seeked 事件门控：
    // 回跳发出后先转入「等待 seek 完成」状态，watchLoop 暂停判断，seeked 触发后才恢复轮询。
    let seekingBack = false;
    const watchLoop = () => {
      if (this.gen !== gen) return;
      if (!seekingBack && el.currentTime >= loopToSec) { atLoopEnd(); return; }
      this._loopRaf = requestAnimationFrame(watchLoop);
    };
    const atLoopEnd = () => {
      if (this.gen !== gen) return;
      if (!d.loop) { if (this._onEnded) this._onEnded(d.action); return; }
      seekingBack = true;
      const onSeeked = () => {
        el.removeEventListener('seeked', onSeeked);
        if (this.gen !== gen) return;
        seekingBack = false;
        el.play().catch(() => {});
        if (loopToSec != null) this._loopRaf = requestAnimationFrame(watchLoop);
      };
      el.addEventListener('seeked', onSeeked);
      el.currentTime = loopFromSec;
    };
    this._stopLoopWatch();
    if (d.still) {
      // 静止帧：不注册循环回调，ready 里 seek 到 loopFrom 后暂停
    } else if (loopToSec != null) {
      this._loopRaf = requestAnimationFrame(watchLoop);
    } else {
      el.onended = atLoopEnd; // 循环到视频自然末尾
    }

    el.load();
    const ready = () => {
      el.removeEventListener('loadeddata', ready);
      if (this.gen !== gen) return;
      const seekTo = d.still ? loopFromSec : fromSec;
      if (seekTo > 0) { try { el.currentTime = seekTo; } catch (e) {} }
      el.playbackRate = d.speed;
      const old = this.frontIndex === 0 ? this.videoA : this.videoB;
      el.style.transform = this._composeTransform(d.flipX, d.flipY);
      el.style.opacity = '1';
      if (old && old !== el) old.style.opacity = '0';
      this.frontIndex = this.frontIndex === 0 ? 1 : 0;
      this._frontFlipX = d.flipX; this._frontFlipY = d.flipY;
      if (d.still) { el.pause(); }        // 定格：seek 到该帧后暂停不播
      else el.play().catch(() => {});
    };
    el.addEventListener('loadeddata', ready);
    if (el.readyState >= 2) ready();
  }

  _stopLoopWatch() { if (this._loopRaf) { cancelAnimationFrame(this._loopRaf); this._loopRaf = null; } }

  /** 播当前动作的收尾段：从当前帧继续播到 to（或末尾），播完切到 _pending */
  _playExit() {
    const d = this._cur;
    const front = this.frontIndex === 0 ? this.videoA : this.videoB;
    if (!front) { this._flushPending(); return; }
    this._stopLoopWatch();
    this._exiting = true;
    const gen = this.gen; // 不自增：继续用当前前台 video 播收尾
    const toSec = d.to != null ? d.to / this.fps : null;
    front.loop = false;
    const done = () => {
      front.ontimeupdate = null; front.onended = null;
      this._flushPending();
    };
    front.onended = done;
    if (toSec != null) front.ontimeupdate = () => { if (front.currentTime >= toSec) done(); };
    front.play().catch(() => {});
    // 兜底：收尾段异常不结束时，按剩余时长兜底切走
    const remain = (toSec != null ? toSec : (isFinite(front.duration) ? front.duration : 3)) - front.currentTime;
    clearTimeout(this._exitT);
    this._exitT = setTimeout(done, Math.max(0, remain * 1000 / (front.playbackRate || 1)) + 150);
  }

  _flushPending() {
    clearTimeout(this._exitT);
    this._exiting = false;
    const p = this._pending; this._pending = null;
    if (p) { const d = this._resolve(p.action, p.meta); if (d && d.file) this._start(d, p.meta); }
  }

  setFacing(dir) {
    super.setFacing(dir);
    const front = this.frontIndex === 0 ? this.videoA : this.videoB;
    if (front) front.style.transform = this._composeTransform(this._frontFlipX, this._frontFlipY);
  }

  destroy() {
    this.gen++;
    clearTimeout(this._exitT);
    this._stopLoopWatch();
    if (this.stage && this.stage.parentNode) this.stage.parentNode.removeChild(this.stage);
    this.stage = this.videoA = this.videoB = null;
  }
}

registerRenderer('webm', WebmRenderer);
