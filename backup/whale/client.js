// client.js — whale-on-desk 浏览器端复刻
//
// 原版分宿主端（Node，折叠事件 + HTTP）和浏览器端（轮询 /whale/state 渲染）。
// 这里没有 DSH 服务器，所以把两半合到一个页面：
//   - WhaleMachine 直接在页面里跑（相当于宿主端的 fold + machine）
//   - 一个"模拟 Agent 事件"面板代替真实 DSH 会话事件
//   - 渲染层订阅 machine.onChange，切换 webm、播音效、联动成长系统
//
// 渲染保留原版关键机制：双 <video> 交叉淡入、状态→webm、缺失回退 idle、
// 位置记忆（localStorage）、拖拽、点击/双击 → user/poke、长按 → user/pet。

import { WhaleMachine } from './state-machine.js';
import { MANIFEST, SCALE, SOUNDS } from './manifest.js';
import { loadGrowth, saveGrowth, applyGrowth, growthView } from './growth.js';

const THUMB_BASE = '../assets/thumb/';
const POS_KEY = 'pet-study-whale:pos';
const SIZE = 300; // 宠物宽度 px
const FEET_Y = 330; // 640x360 画布上的脚线
const CANVAS_H = 360;

// —— 合成音效（源自 client.js 第 43-79 行）——
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, start, dur, type, volume) {
  const ctx = audioCtx;
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function playSound(state) {
  ensureAudio();
  const seq = SOUNDS[state];
  if (seq) seq.forEach((s) => tone(...s));
}

// —— 宠物渲染实例 ——
class WhalePet {
  constructor(machine, growth, hud) {
    this.machine = machine;
    this.growth = growth;
    this.hud = hud;
    this.halfW = SIZE / 2;
    this.halfH = (SIZE * 9) / 16 / 2;
    this.frontIndex = 0;
    this.pending = null;
    this.gen = 0;
    this.prevState = null;
    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, offX: 0, offY: 0 };
    this.justDragged = false;
    this.petTimer = null;
    this.customPos = null;

    this._buildDom();
    this._bindEvents();
    this._restorePos();
  }

  _buildDom() {
    const root = document.createElement('div');
    root.className = 'whale-root';
    const stage = document.createElement('div');
    stage.className = 'whale-stage';
    const a = document.createElement('video');
    a.className = 'whale-video is-front';
    const b = document.createElement('video');
    b.className = 'whale-video';
    for (const v of [a, b]) { v.muted = true; v.playsInline = true; v.autoplay = true; }
    const bubble = document.createElement('div');
    bubble.className = 'whale-bubble';
    stage.appendChild(a);
    stage.appendChild(b);
    root.appendChild(stage);
    root.appendChild(bubble);
    document.body.appendChild(root);
    this.root = root; this.stage = stage; this.videoA = a; this.videoB = b; this.bubble = bubble;
    this.root.style.setProperty('--whale-size', SIZE + 'px');
    const bottomPad = ((SIZE * 9) / 16 * (CANVAS_H - FEET_Y)) / CANVAS_H;
    this.bottomPad = bottomPad;
    this.stage.style.transform = 'translateY(' + bottomPad + 'px)';
  }

  say(text) {
    if (!text) return;
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    clearTimeout(this._bubbleTimer);
    this._bubbleTimer = setTimeout(() => this.bubble.classList.remove('show'), 2600);
  }

  render(snap) {
    const state = snap.state;
    const name = MANIFEST[state] || MANIFEST.idle; // 缺失回退 idle
    // 状态改变才播音效 / 冒泡（源自 client.js 第 703-708）
    if (state !== this.prevState) {
      playSound(state);
      if (snap.hint && snap.hint.say) this.say(snap.hint.say);
      this.prevState = state;
    }
    this._switchVideo(name, state);
  }

  _switchVideo(name, state) {
    const gen = ++this.gen;
    const el = this.frontIndex === 0 ? this.videoB : this.videoA;
    el.src = THUMB_BASE + encodeURIComponent(name) + '.webm';
    el.loop = true;
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      if (this.gen !== gen) return;
      const old = this.frontIndex === 0 ? this.videoA : this.videoB;
      const sc = (SCALE[state] && SCALE[state].s) || 1;
      el.style.transform = 'scale(' + sc + ')';
      el.classList.add('is-front');
      if (old && old !== el) old.classList.remove('is-front');
      this.frontIndex = this.frontIndex === 0 ? 1 : 0;
      el.play().catch(() => {});
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }

  // —— 拖拽 / 点击 / 双击 / 长按摸头（源自 client.js 第 750-803）——
  _bindEvents() {
    this.root.style.pointerEvents = 'auto';
    this.root.addEventListener('pointerdown', (e) => this.onDown(e));
    this.root.addEventListener('pointermove', (e) => this.onMove(e));
    this.root.addEventListener('pointerup', (e) => this.onUp(e));
    this.root.addEventListener('dblclick', () => this.machine.push({ type: 'user/poke', doubleClick: true }));
  }
  onDown(e) {
    const rr = this.root.getBoundingClientRect();
    this.dragState = {
      active: true, dragging: false, sx: e.clientX, sy: e.clientY,
      offX: e.clientX - (rr.left + rr.width / 2), offY: e.clientY - (rr.top + rr.height / 2),
    };
    this.root.setPointerCapture(e.pointerId);
    this.petTimer = setTimeout(() => {
      if (this.dragState.active && !this.dragState.dragging) {
        playSound('pet');
        this.machine.push({ type: 'user/pet' });
      }
    }, 800);
  }
  onMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
      d.dragging = true;
      clearTimeout(this.petTimer);
    }
    const left = Math.max(0, Math.min(window.innerWidth - SIZE, e.clientX - d.offX - this.halfW));
    const top = Math.max(0, Math.min(window.innerHeight - (SIZE * 9) / 16, e.clientY - d.offY - this.halfH));
    this.root.style.left = left + 'px';
    this.root.style.top = top + 'px';
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
  }
  onUp(e) {
    const d = this.dragState;
    const wasDrag = d.dragging;
    clearTimeout(this.petTimer);
    d.active = false; d.dragging = false;
    if (wasDrag) {
      this.justDragged = true;
      setTimeout(() => (this.justDragged = false), 120);
      const left = parseFloat(this.root.style.left) || 0;
      const top = parseFloat(this.root.style.top) || 0;
      this.customPos = { x: left, y: top };
      try { localStorage.setItem(POS_KEY, JSON.stringify(this.customPos)); } catch (err) {}
    } else if (!this.justDragged) {
      this.machine.push({ type: 'user/poke', doubleClick: false });
    }
  }
  _restorePos() {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && typeof saved.x === 'number') {
        this.root.style.left = Math.max(0, Math.min(saved.x, window.innerWidth - SIZE)) + 'px';
        this.root.style.top = Math.max(0, Math.min(saved.y, window.innerHeight - (SIZE * 9) / 16)) + 'px';
        this.root.style.right = 'auto';
        this.root.style.bottom = 'auto';
        this.customPos = saved;
      }
    } catch (e) {}
  }
}

// —— HUD：状态 + 成长面板 ——
function renderHud(machine, growth) {
  const gv = growthView(growth);
  const el = document.getElementById('whale-hud');
  if (!el) return;
  el.innerHTML =
    `<div class="row"><b>state</b> <span class="pill">${machine.state}</span></div>` +
    `<div class="row"><b>Lv.${gv.level}</b> XP ${gv.xp} (还需 ${gv.toNext})</div>` +
    `<div class="bar"><i style="width:${gv.progress * 100}%"></i></div>` +
    `<div class="row muted">称号: ${gv.titles.join('、') || '（暂无）'}</div>` +
    `<div class="row muted">任务 ${gv.stats.tasks} · 会话 ${gv.stats.sessions}</div>` +
    (gv.memory.length ? `<div class="mem">${gv.memory.map((m) => `<div>${m}</div>`).join('')}</div>` : '');
}

// —— 引导 ——
function main() {
  const growth = loadGrowth();
  let pet = null;

  const machine = new WhaleMachine((snap) => {
    if (pet) pet.render(snap);
    renderHud(machine, growth);
  });

  pet = new WhalePet(machine, growth, null);

  // 成长联动：turn/start = 新会话，turn/end 成功 = 完成任务（源自 index.js fold）
  const origPush = machine.push.bind(machine);
  machine.push = (ev) => {
    if (ev.type === 'turn/start') {
      const sig = applyGrowth(growth, { kind: 'session-new' });
      if (sig.leveledUpTo) pet.say(`升到 Lv.${sig.leveledUpTo}！`);
      saveGrowth(growth);
    }
    if (ev.type === 'turn/end' && ev.reason !== 'error' && ev.reason !== 'aborted') {
      const sig = applyGrowth(growth, { kind: 'task-done' });
      applyGrowth(growth, { kind: 'streak', count: machine.winStreak + 1 });
      if (sig.newTitles.length) pet.say(`解锁「${sig.newTitles[0].name}」`);
      saveGrowth(growth);
    }
    if (ev.type === 'turn/end' && (ev.reason === 'error' || ev.reason === 'aborted')) {
      applyGrowth(growth, { kind: 'task-failed' });
      saveGrowth(growth);
    }
    origPush(ev);
  };

  // 活跃时长累积：工作态每 15 秒 +time（源自 index.js 第 125-135）
  setInterval(() => {
    const working = ['swim-fast', 'think', 'tool-run', 'review', 'token-fountain'];
    if (working.includes(machine.state)) {
      const h = new Date().getHours();
      applyGrowth(growth, { kind: 'active-time', ms: 15_000, night: h >= 0 && h < 6 });
      saveGrowth(growth);
      renderHud(machine, growth);
    }
  }, 15_000);

  // 初始渲染
  machine._emit();
  renderHud(machine, growth);

  // 模拟事件面板按钮
  document.querySelectorAll('[data-ev]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spec = JSON.parse(btn.dataset.ev);
      machine.push(spec);
    });
  });

  // 一键跑一整个"任务回合"演示
  const demoBtn = document.getElementById('whale-demo-run');
  if (demoBtn) {
    demoBtn.addEventListener('click', async () => {
      const seq = [
        { type: 'turn/start' },
        { type: 'assistant/chunk', kind: 'reasoning' },
        { type: 'tool/call', tool: 'read_file' },
        { type: 'tool/call', tool: 'grep' },
        { type: 'tool/call', tool: 'glob' },
        { type: 'tool/call', tool: 'read_file' }, // 连续 4 个读 → review
        { type: 'tool/call', tool: 'edit' }, // → tool-run
        { type: 'approval/asked' }, // → glass-tap 锁定
        { type: 'approval/decided', approved: true },
        { type: 'assistant/chunk', kind: 'text' },
        { type: 'turn/end', reason: 'completed' },
      ];
      for (const ev of seq) {
        machine.push(ev);
        await new Promise((r) => setTimeout(r, 1600));
      }
    });
  }

  window.__whale = { machine, growth, pet };
}

main();
