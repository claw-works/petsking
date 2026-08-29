// client.js — dsh-desktop-pet 浏览器端复刻
//
// 原版是原生桌面窗口（Win32/X11 透明层）+ sprite sheet 逐帧渲染 + koffi/sharp。
// 这里没有原生窗口，用 webm 在网页里表达同一套「确定性语义状态机 → 姿势」逻辑。
//
// 保留核心机制：
//   - PetStateMachine 折叠多任务优先级得到全局语义状态
//   - 状态 → 姿势（SEMANTIC_TO_POSE）→ webm
//   - SLEEPING 用专门睡眠动画 + 变暗
//   - idle 每 IDLE_FREQ_MS 随机换 idle 变体（复刻 AnimationController 的 idle 变化）
//   - /pet <state> 开发者命令（原版 ctx.commands 注册）

import { PetStateMachine, STATES, SEMANTIC_TO_POSE, STATE_PRIORITY } from './core.js';
import { POSE_MANIFEST, SLEEP_ANIM, IDLE_FREQ_MS } from './manifest.js';

const THUMB_BASE = '../assets/thumb/';
const SIZE = 300;
const FEET_Y = 330;
const CANVAS_H = 360;

class DesktopPet {
  constructor(machine) {
    this.machine = machine;
    this.frontIndex = 0;
    this.gen = 0;
    this.curPose = null;
    this.curAnim = null;
    this.idleTimer = null;
    this._buildDom();
  }

  _buildDom() {
    const root = document.createElement('div');
    root.className = 'dp-root';
    const stage = document.createElement('div');
    stage.className = 'dp-stage';
    const a = document.createElement('video');
    a.className = 'dp-video is-front';
    const b = document.createElement('video');
    b.className = 'dp-video';
    for (const v of [a, b]) { v.muted = true; v.playsInline = true; v.autoplay = true; }
    stage.appendChild(a); stage.appendChild(b);
    root.appendChild(stage);
    document.body.appendChild(root);
    this.root = root; this.stage = stage; this.videoA = a; this.videoB = b;
    root.style.setProperty('--dp-size', SIZE + 'px');
    const pad = ((SIZE * 9) / 16 * (CANVAS_H - FEET_Y)) / CANVAS_H;
    stage.style.transform = 'translateY(' + pad + 'px)';
  }

  /** 全局语义状态变化时调用 */
  onState(state) {
    const pose = SEMANTIC_TO_POSE[state];
    const sleeping = state === 'SLEEPING';
    this.root.classList.toggle('sleeping', sleeping);

    // SLEEPING 用专门动画
    if (sleeping) {
      this._play(SLEEP_ANIM);
      this._stopIdleCycle();
      this.curPose = pose;
      return;
    }

    // 换姿势：从候选池抽一个
    if (pose !== this.curPose) {
      this.curPose = pose;
      this._play(this._pickAnim(pose));
    }

    // 仅 idle 姿势启动「定期随机变体」循环
    if (pose === 'idle') this._startIdleCycle();
    else this._stopIdleCycle();
  }

  _pickAnim(pose) {
    const pool = POSE_MANIFEST[pose] || POSE_MANIFEST.idle;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _startIdleCycle() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      if (this.curPose !== 'idle') return;
      const next = this._pickAnim('idle');
      if (next !== this.curAnim) this._play(next);
    }, IDLE_FREQ_MS);
  }
  _stopIdleCycle() {
    if (this.idleTimer) { clearInterval(this.idleTimer); this.idleTimer = null; }
  }

  _play(name) {
    if (name === this.curAnim) return;
    this.curAnim = name;
    const gen = ++this.gen;
    const el = this.frontIndex === 0 ? this.videoB : this.videoA;
    el.src = THUMB_BASE + encodeURIComponent(name) + '.webm';
    el.loop = true;
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      if (this.gen !== gen) return;
      const old = this.frontIndex === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) old.classList.remove('is-front');
      this.frontIndex = this.frontIndex === 0 ? 1 : 0;
      el.play().catch(() => {});
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
  }
}

function renderHud(machine) {
  const el = document.getElementById('dp-hud');
  if (!el) return;
  const snap = machine.snapshot();
  const tasks = snap.tasks.map(([id, t]) => `<div class="trow"><b>${id}</b> ${t.state} <span class="p">P${STATE_PRIORITY[t.state]}</span></div>`).join('');
  el.innerHTML =
    `<div class="row">全局状态 <span class="pill">${snap.state}</span></div>` +
    `<div class="row muted">姿势 → ${snap.pose}</div>` +
    `<div class="tasks-title">并发任务（折叠取最高优先级）</div>` +
    (tasks || '<div class="muted">（无活跃任务）</div>');
}

function main() {
  let pet = null;
  const machine = new PetStateMachine((state) => {
    if (pet) pet.onState(state);
    renderHud(machine);
  }, { sleepAfterMs: 12_000, flashMs: 2000 }); // 演示：12 秒静默入睡

  pet = new DesktopPet(machine);
  pet.onState('IDLE');
  renderHud(machine);
  setInterval(() => renderHud(machine), 500); // 让 HUD 反映 flash/sleep 定时回落

  // 单任务事件面板
  document.querySelectorAll('[data-ev]').forEach((btn) => {
    btn.addEventListener('click', () => machine.handle(JSON.parse(btn.dataset.ev)));
  });

  // 多任务并发演示：同时开三个 task，展示优先级折叠
  const concBtn = document.getElementById('dp-concurrency');
  if (concBtn) {
    concBtn.addEventListener('click', () => {
      machine.handle({ type: 'agent.thinking', taskId: 'agent-A' }); // THINKING(30)
      machine.handle({ type: 'tool.started', tool: 'bash', taskId: 'agent-B' }); // RUNNING_COMMAND(40)
      setTimeout(() => {
        machine.handle({ type: 'user_input.required', taskId: 'agent-C' }); // WAITING(60) → 全局变 WAITING
      }, 1500);
      setTimeout(() => {
        machine.handle({ type: 'user_input.resolved', taskId: 'agent-C' });
        machine.handle({ type: 'task.completed', taskId: 'agent-B' }); // B 成功 flash
      }, 3500);
      setTimeout(() => {
        machine.removeTask('agent-A');
        machine.removeTask('agent-B');
        machine.removeTask('agent-C');
      }, 6000);
    });
  }

  // /pet <state> 开发者命令（原版 ctx.commands）
  const cmdInput = document.getElementById('dp-cmd');
  if (cmdInput) {
    cmdInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const s = cmdInput.value.trim().toUpperCase();
      if (s === 'RESET') { machine.tasks.clear(); machine._recompute(); }
      else if (STATES.includes(s)) {
        machine.tasks.set('cmd', { state: s, flashUntil: Date.now() + 999999 });
        machine._recompute();
      }
      cmdInput.value = '';
    });
  }

  window.__dp = { machine, pet };
}

main();
