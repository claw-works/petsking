// client.js — 渲染方案④：SVG 矢量骨骼动画
//
// 与位图方案（gif/spritesheet/像素）根本不同：宠物是矢量图形 + 关节，动画靠
// 「关节角度/位移的缓动补间」（连续插值），不是切帧。放大不糊、体积极小、可换色。
//
// 驱动：共享 ChainDriver（概率链）。动作 = 一个姿势(pose) + 周期叠加(loop)，
//       render 回调让 Rig 缓动到该姿势。

import { ChainDriver } from '../render-core/chain.js';
import { buildPet, POSES, COLORS } from './pet-rig.js';

const POOL = {
  idle: ['idle', 'blink'],
  actions: ['walk', 'wave'],
  categories: [
    { id: '运动', weight: 40, actions: ['walk', 'jump', 'spin'] },
    { id: '卖萌', weight: 35, actions: ['blink', 'cheer', 'dance'] },
    { id: '情绪', weight: 25, actions: ['shy', 'angry', 'sleep'] },
  ],
  clicks: ['cheer', 'jump', 'shy'],
  weights: { idle: 30, action: 25 },
};

function main() {
  const stage = document.getElementById('svg-stage');
  const hud = document.getElementById('svg-hud');
  const picker = document.getElementById('svg-picker');

  let colorName = '蓝噗';
  let built = buildPet(stage, COLORS[colorName]);
  built.rig.start();

  // 眨眼是短促动作：切到 blink 后 140ms 自动回 idle（否则会一直眯着）
  let blinkTimer = null;

  function applyPose(name) {
    const p = POSES[name] || POSES.idle;
    built.rig.setLoop(p.loop || null);
    built.rig.tweenTo(p.pose, p.dur);
    if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
    if (name === 'blink') {
      blinkTimer = setTimeout(() => {
        const idle = POSES.idle;
        built.rig.setLoop(idle.loop);
        built.rig.tweenTo(idle.pose, 120);
      }, 140);
    }
  }

  const driver = new ChainDriver({
    ...POOL,
    playMs: (name) => (name === 'blink' ? 900 : 2200 + Math.random() * 2000),
    render: (name) => applyPose(name),
    onPick: (name, kind) => {
      const row = document.createElement('div');
      row.textContent = `${new Date().toTimeString().slice(0, 8)}  [${kind}] ${name}`;
      hud.insertBefore(row, hud.firstChild);
      while (hud.childElementCount > 10) hud.removeChild(hud.lastChild);
    },
  });

  stage.addEventListener('click', () => driver.click());

  // 换配色（重建 SVG）
  Object.keys(COLORS).forEach((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      colorName = name;
      built.rig.stop();
      stage.innerHTML = '';
      built = buildPet(stage, COLORS[name]);
      built.rig.start();
      applyPose(driver.current || 'idle');
    });
    picker.appendChild(b);
  });

  driver.start();
  window.__svg = { driver, rig: built.rig };
}

main();
