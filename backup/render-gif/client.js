// client.js — 渲染方案①：GIF（<img> 切换）
//
// 美术：whale-on-desk 的全套鲸鱼 GIF（每个动作一个 .gif）。
// 渲染：最朴素的方案——一个 <img>，换 src 即换动画。GIF 自带循环和帧时序，
//       前端只管「什么时候换成哪个 gif」，这正好交给概率链内核。
//
// 驱动：共享的 ChainDriver（概率动画链），动作池用鲸鱼的动作名。

import { ChainDriver } from '../render-core/chain.js';

const BASE = 'assets/';
// 鲸鱼可用的 gif 动作（取自 whale manifest，挑适合当「日常动作」的）
const POOL = {
  idle: ['idle', 'sleep', 'think'],
  actions: ['swim-fast', 'review', 'eat', 'shrimp'],
  categories: [
    { id: '玩耍', weight: 40, actions: ['chase-fish', 'bubble-ring', 'hide-and-seek'] },
    { id: '情绪', weight: 35, actions: ['excited', 'proud', 'shy', 'celebrate'] },
    { id: '节庆', weight: 25, actions: ['birthday', 'success-streak', 'push'] },
  ],
  clicks: ['startled', 'poked-flail', 'excited'],
  weights: { idle: 30, action: 25 }, // category = 45
};

function preload(names) {
  names.forEach((n) => { const i = new Image(); i.src = BASE + n + '.gif'; });
}

function main() {
  const img = document.getElementById('gif-pet');
  const hud = document.getElementById('gif-hud');

  // 预加载全部用到的 gif，切换时不闪
  const all = new Set([...POOL.idle, ...POOL.actions, ...POOL.clicks]);
  POOL.categories.forEach((c) => c.actions.forEach((a) => all.add(a)));
  preload([...all]);

  const driver = new ChainDriver({
    ...POOL,
    playMs: () => 2400 + Math.random() * 1600, // GIF 每 2.4~4s 换一个
    render: (name) => {
      // 加时间戳强制 GIF 从头播（否则切回同名 gif 不会重头）
      img.src = BASE + name + '.gif';
      img.dataset.anim = name;
    },
    onPick: (name, kind) => {
      const line = `${new Date().toTimeString().slice(0, 8)}  [${kind}] ${name}.gif`;
      const row = document.createElement('div');
      row.textContent = line;
      hud.insertBefore(row, hud.firstChild);
      while (hud.childElementCount > 10) hud.removeChild(hud.lastChild);
    },
  });

  // 点击回应
  img.addEventListener('click', () => driver.click());

  driver.start();
  window.__gif = { driver };
}

main();
