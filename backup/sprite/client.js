// client.js — dsh-pet-sprite 浏览器端复刻
//
// 原版是像素精灵（24x28 网格调色板逐帧手绘）+ 平台跳跃物理，宠物住在聊天区、
// 把用户气泡当平台，可 WASD 控制，带养成系统。
//
// 这里用 webm 替代像素精灵：宠物 stage 承载 webm，物理引擎作用在 stage 的 (x,h)。
// 物理状态（ground/move/air）→ webm 切换。页面放几个 .plat 消息气泡当平台。
//
// 保留核心：重力/碰撞/跳跃、自主规划 vs 玩家控制（10s 回自主）、养成属性 tick、
// 属性驱动动画（饿了/困了播不同 webm）、拖拽。

import { SpritePhysics, PW } from './physics.js';
import { Nurture, save } from './nurture.js';

const THUMB_BASE = '../assets/thumb/';
const STAGE_W = PW * 2.2; // webm 舞台宽度
const STAGE_H = (STAGE_W * 9) / 16;
const FEET_Y = 330, CANVAS_H = 360;

// 物理状态 → webm（＋属性驱动的覆盖）
const ANIM = {
  ground: '待机呼吸休闲',
  move: '原地左转奔跑',
  air: '原地跳跃抓碎头顶物品',
  climb: '螃蟹走路',
  work: '写代码',
  sleep: '原地小憩沉眠',
  starving: '哈欠连天',
  happy: '可爱宅舞',
};

class SpritePet {
  constructor(arena, phys, nurture) {
    this.arena = arena; this.phys = phys; this.nurture = nurture;
    this.frontIndex = 0; this.gen = 0; this.curAnim = null; this.mode = 'idle';
    this._build();
  }
  _build() {
    const root = document.createElement('div');
    root.className = 'sp-root';
    const stage = document.createElement('div');
    stage.className = 'sp-stage';
    const a = document.createElement('video'); a.className = 'sp-video is-front';
    const b = document.createElement('video'); b.className = 'sp-video';
    for (const v of [a, b]) { v.muted = true; v.playsInline = true; v.autoplay = true; }
    stage.appendChild(a); stage.appendChild(b);
    root.appendChild(stage);
    this.arena.appendChild(root);
    this.root = root; this.stage = stage; this.videoA = a; this.videoB = b;
    root.style.width = STAGE_W + 'px';
    root.style.height = STAGE_H + 'px';
    this.footPad = (STAGE_H * (CANVAS_H - FEET_Y)) / CANVAS_H;
  }

  _pickAnim() {
    const lv = this.nurture.levels();
    const ps = this.phys.animState();
    if (ps === 'air') return ANIM.air;
    if (ps === 'move') return ANIM.move;
    // 地面静止：属性 / 工作模式覆盖
    if (this.mode === 'work') return ANIM.work;
    if (lv.power === 'starving' || lv.health === 'sick') return ANIM.starving;
    if (lv.mood === 'joyful') return ANIM.happy;
    return ANIM.ground;
  }

  _play(name) {
    if (name === this.curAnim) return;
    this.curAnim = name;
    const gen = ++this.gen;
    const el = this.frontIndex === 0 ? this.videoB : this.videoA;
    el.src = THUMB_BASE + encodeURIComponent(name) + '.webm';
    el.loop = true; el.load();
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

  render() {
    // 位置：竞技场坐标 (x, h) → CSS left/bottom
    this.root.style.left = this.phys.x + 'px';
    this.root.style.bottom = this.phys.h - this.footPad + 'px';
    // 朝向
    const flip = this.phys.dir === -1 ? ' scaleX(-1)' : '';
    this.stage.style.transform = flip;
    // 动画
    this._play(this._pickAnim());
  }
}

function renderHud(nurture, phys) {
  const el = document.getElementById('sp-hud');
  if (!el) return;
  const v = nurture.view();
  const bar = (label, val, max, color) =>
    `<div class="attr"><span>${label}</span><i style="width:${(val / max) * 100}%;background:${color}"></i><b>${val}</b></div>`;
  el.innerHTML =
    `<div class="row"><b>Lv.${v.level}</b> <span class="tier">${v.tierName}</span> · XP ${v.exp}（还需 ${v.expToNext}）</div>` +
    `<div class="bar"><i style="width:${v.expProgress * 100}%"></i></div>` +
    bar('心情', v.mood, 100, '#f2839b') +
    bar('电量', v.power, 300, '#4d6efa') +
    bar('健康', v.health, 100, '#38b87c') +
    `<div class="row muted">模式 ${phys.playerCtl ? '🎮 玩家控制' : '🤖 自主'} · 物理 ${phys.animState()}</div>`;
}

function main() {
  const arena = document.getElementById('arena');
  const phys = new SpritePhysics(arena);
  const nurture = new Nurture();
  const pet = new SpritePet(arena, phys, nurture);

  phys.refreshPlatforms();
  window.addEventListener('resize', () => phys.refreshPlatforms());
  // 平台可能因布局变化，定期重扫
  setInterval(() => phys.refreshPlatforms(), 1000);

  // 键盘：WASD + 空格
  const keyMap = { a: 'left', d: 'left', A: 'left', D: 'right', w: 'jump', s: 'drop', ' ': 'jump' };
  const map = (e) => {
    const k = e.key;
    if (k === 'a' || k === 'A' || k === 'ArrowLeft') return 'left';
    if (k === 'd' || k === 'D' || k === 'ArrowRight') return 'right';
    if (k === 'w' || k === 'W' || k === 'ArrowUp' || k === ' ') return 'jump';
    if (k === 's' || k === 'S' || k === 'ArrowDown') return 'drop';
    return null;
  };
  window.addEventListener('keydown', (e) => { const m = map(e); if (m) { e.preventDefault(); phys.onKey(m, true); } });
  window.addEventListener('keyup', (e) => { const m = map(e); if (m) phys.onKey(m, false); });

  // 点击竞技场背景 → 接管控制；点平台/宠物不算
  arena.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sp-root') || e.target.closest('.plat')) return;
    phys.setControl(true);
  });

  // 照顾按钮
  document.querySelectorAll('[data-care]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sig = nurture.care(btn.dataset.care);
      save(nurture.s);
      renderHud(nurture, phys);
      if (sig.leveledUp) flash(`升到 Lv.${sig.leveledUp}！`);
    });
  });

  // 模拟对话：输入掉 power，输出转 XP（token 经济）
  const chatBtn = document.getElementById('sp-chat');
  if (chatBtn) {
    chatBtn.addEventListener('click', () => {
      const input = document.getElementById('sp-input');
      const text = (input && input.value) || '帮我写一段排序算法';
      nurture.onUserMessage(text);
      pet.mode = 'work';
      renderHud(nurture, phys);
      setTimeout(() => {
        const sig = nurture.onAssistantDone(600 + Math.floor(Math.random() * 800));
        pet.mode = 'idle';
        save(nurture.s);
        renderHud(nurture, phys);
        if (sig.leveledUp) flash(`升到 Lv.${sig.leveledUp}！`);
      }, 2500);
    });
  }

  function flash(msg) {
    const el = document.getElementById('sp-flash');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
  }

  // 主循环
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    phys.update(dt, now);
    pet.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 养成 tick + HUD
  setInterval(() => { nurture.tick(); save(nurture.s); renderHud(nurture, phys); }, 2000);
  renderHud(nurture, phys);

  window.__sprite = { phys, nurture, pet };
}

main();
