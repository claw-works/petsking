// client.js — 渲染方案②：sprite sheet 逐帧（canvas 切图）
//
// 美术：dsh-desktop-pet 的 text 精灵表（一张 spritesheet.webp，8×9 格）。
// 渲染：canvas 从大图里 drawImage 切出当前帧，按每帧独立时长逐帧循环播放。
//       这是真正的「逐帧动画引擎」——GIF 把时序封在文件里，这里时序在代码里显式控制。
//
// 驱动：共享 ChainDriver（概率链）。动作池 = 精灵表的 9 个状态行。

import { ChainDriver } from '../render-core/chain.js';
import { SheetAnimator, ANIMATION_ROWS } from './sheet.js';

// 精灵表可用状态（running-right/left 归入移动类）
const POOL = {
  idle: ['idle', 'waiting'],
  actions: ['running', 'review'],
  categories: [
    { id: '移动', weight: 45, actions: ['running-right', 'running-left', 'running'] },
    { id: '表演', weight: 35, actions: ['waving', 'jumping'] },
    { id: '情绪', weight: 20, actions: ['review', 'failed'] },
  ],
  clicks: ['waving', 'jumping'],
  weights: { idle: 30, action: 25 },
};

// 每个状态播多久 = 该行所有帧时长之和 × 循环几遍
function playMsFor(state) {
  const row = ANIMATION_ROWS.find((r) => r.state === state);
  const one = row ? row.durations.reduce((a, b) => a + b, 0) : 1000;
  const loops = 2 + Math.floor(Math.random() * 3); // 循环 2~4 遍再换
  return one * loops;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function main() {
  const cv = document.getElementById('sheet-canvas');
  const hud = document.getElementById('sheet-hud');
  const img = await loadImage('assets/spritesheet.webp');
  const animator = new SheetAnimator(cv, img);

  const driver = new ChainDriver({
    ...POOL,
    playMs: playMsFor,
    render: (state) => animator.setState(state),
    onPick: (name, kind) => {
      const row = document.createElement('div');
      row.textContent = `${new Date().toTimeString().slice(0, 8)}  [${kind}] row=${name}`;
      hud.insertBefore(row, hud.firstChild);
      while (hud.childElementCount > 10) hud.removeChild(hud.lastChild);
    },
  });

  cv.addEventListener('click', () => driver.click());
  driver.start();
  window.__sheet = { driver, animator };
}

main().catch((e) => {
  document.getElementById('sheet-hud').textContent = '加载失败: ' + e.message;
});
