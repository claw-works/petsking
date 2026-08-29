// client.js — 渲染方案⑤：Three.js 3D
//
// 第五种渲染载体：真 3D。宠物是几何体拼的 3D 模型，有光照/阴影/透视，可自由旋转看各角度。
// 动画靠补间各关节的 rotation/position/scale（和 SVG 骨骼同思路，扩展到三维）。
//
// 驱动：共享 ChainDriver（概率链），render 回调 = 让 Pet3D 缓动到目标姿势。

import { ChainDriver } from '../render-core/chain.js';
import { Pet3D, POSES3D, COLORS3D } from './pet3d.js';

const POOL = {
  idle: ['idle', 'blink', 'nod'],
  actions: ['walk', 'wave'],
  categories: [
    { id: '运动', weight: 40, actions: ['walk', 'jump', 'spin'] },
    { id: '卖萌', weight: 35, actions: ['blink', 'cheer', 'dance'] },
    { id: '情绪', weight: 25, actions: ['shy', 'nod', 'sleep'] },
  ],
  clicks: ['cheer', 'jump', 'shy'],
  weights: { idle: 30, action: 25 },
};

function main() {
  const stage = document.getElementById('stage3d');
  const hud = document.getElementById('hud3d');
  const picker = document.getElementById('picker3d');

  let colorName = '蓝噗';
  let pet = new Pet3D(stage, COLORS3D[colorName]);

  let blinkTimer = null;
  function applyPose(name) {
    const p = POSES3D[name] || POSES3D.idle;
    pet.setLoop(p.loop || null);
    pet.tweenTo(p.pose, p.dur);
    if (blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
    if (name === 'blink') {
      blinkTimer = setTimeout(() => { pet.setLoop(POSES3D.idle.loop); pet.tweenTo(POSES3D.idle.pose, 100); }, 120);
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

  // 视角：默认缓慢自转；鼠标拖拽手动转（放开后过几秒恢复自转）
  let userYaw = 0, autoSpin = true, dragging = false, lastX = 0, resumeTimer = null;
  stage.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; autoSpin = false; if (resumeTimer) clearTimeout(resumeTimer); });
  window.addEventListener('pointermove', (e) => { if (!dragging) return; userYaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    resumeTimer = setTimeout(() => (autoSpin = true), 4000);
  });
  // 点击（非拖拽）触发点击回应
  let downX = 0;
  stage.addEventListener('pointerdown', (e) => (downX = e.clientX));
  stage.addEventListener('click', (e) => { if (Math.abs(e.clientX - downX) < 4) driver.click(); });

  // 主循环
  let autoAngle = 0;
  function loop(now) {
    if (autoSpin) autoAngle += 0.004;
    pet.root.rotation.y = userYaw + (autoSpin ? autoAngle : 0);
    pet.update(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 换配色（重建模型）
  Object.keys(COLORS3D).forEach((name) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => {
      colorName = name;
      const keepYaw = userYaw;
      pet.dispose();
      pet = new Pet3D(stage, COLORS3D[name]);
      userYaw = keepYaw;
      applyPose(driver.current || 'idle');
    });
    picker.appendChild(b);
  });

  driver.start();
  window.__3d = { driver, pet };
}

main();
