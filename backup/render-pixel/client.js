// client.js — 渲染方案③：像素 canvas 手绘（无位图素材）
//
// 美术：dsh-pet-sprite 的三只像素宠物（波卡/橘丸/蓝噗），每只是 24×28 字符网格 +
//       调色板，运行时用 canvas fillRect 一格一格画出来——完全不依赖任何图片文件。
// 渲染：每个「动作」是一组帧键（如行走=WA/WB 交替），rAF 里按 tick 切帧循环。
//
// 驱动：共享 ChainDriver（概率链）。动作 = 帧序列组合，playMs 控制一个动作播多久。

import { ChainDriver } from '../render-core/chain.js';
import { PET_ART, PET_IDS, PET_META, drawPet } from './pet-art.js';

// 动作 → 帧序列（帧键取自 pet-art.ts：I待机 B呼吸 BL眨眼 ZZ睡 WA/WB行走 KA/KB跑 JP跳）
const MOVES = {
  idle: ['I', 'B', 'I', 'BL'],       // 待机：呼吸 + 偶尔眨眼
  sleep: ['ZZ', 'ZZ', 'BL'],          // 睡觉
  walk: ['WA', 'WB'],                 // 走
  run: ['KA', 'KB'],                  // 跑
  jump: ['JP', 'JP', 'B'],            // 跳
  cheer: ['JP', 'I', 'JP', 'B'],      // 欢呼
  blink: ['BL', 'I', 'BL', 'I'],      // 眨眼卖萌
};

const POOL = {
  idle: ['idle', 'blink'],
  actions: ['walk', 'run'],
  categories: [
    { id: '运动', weight: 45, actions: ['walk', 'run', 'jump'] },
    { id: '卖萌', weight: 35, actions: ['blink', 'cheer'] },
    { id: '休息', weight: 20, actions: ['sleep', 'idle'] },
  ],
  clicks: ['jump', 'cheer'],
  weights: { idle: 30, action: 25 },
};

const FRAME_MS = 260; // 每帧 260ms 切换

function main() {
  const cv = document.getElementById('pixel-canvas');
  const hud = document.getElementById('pixel-hud');
  const picker = document.getElementById('pixel-picker');

  let petId = 'puff';
  let seq = MOVES.idle;
  let frameStep = 0;

  // rAF 帧循环：按当前动作的帧序列循环绘制
  let lastFrameAt = 0;
  function loop(now) {
    if (now - lastFrameAt >= FRAME_MS) {
      lastFrameAt = now;
      const key = seq[frameStep % seq.length];
      const frames = PET_ART[petId][key] || PET_ART[petId].I;
      drawPet(cv, frames);
      frameStep += 1;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  const driver = new ChainDriver({
    ...POOL,
    playMs: () => 2000 + Math.random() * 2000,
    render: (move) => { seq = MOVES[move] || MOVES.idle; frameStep = 0; },
    onPick: (name, kind) => {
      const row = document.createElement('div');
      row.textContent = `${new Date().toTimeString().slice(0, 8)}  [${kind}] ${name}`;
      hud.insertBefore(row, hud.firstChild);
      while (hud.childElementCount > 10) hud.removeChild(hud.lastChild);
    },
  });

  cv.addEventListener('click', () => driver.click());

  // 换宠物按钮
  PET_IDS.forEach((id) => {
    const b = document.createElement('button');
    b.textContent = PET_META[id].name;
    b.title = PET_META[id].tagline;
    b.addEventListener('click', () => { petId = id; });
    picker.appendChild(b);
  });

  driver.start();
  window.__pixel = { driver, setPet: (id) => (petId = id) };
}

main();
