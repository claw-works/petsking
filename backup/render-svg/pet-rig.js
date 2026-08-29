// pet-rig.js — 矢量宠物的 SVG 结构 + 关节 + 动作姿势库
//
// 宠物是一只圆滚滚的小生物，在 200×220 的坐标系里画（viewBox）。
// 每个可动部件包在一个 <g> 里，<g> 的 transform 由 Rig 驱动。
//
// 关节树（简化，非严格父子层级，够用即可）：
//   body（整体） → head（头，含眼/腮） → armL/armR（手臂）→ legL/legR（腿）
//
// 动作 = 给若干关节一组目标值（角度/位移/缩放），Rig 缓动过去。

import { Rig } from './rig.js';

// 关节旋转锚点（在 viewBox 坐标里，尽量放在“关节根部”）
const ANCHORS = {
  body: { cx: 100, cy: 130 },
  head: { cx: 100, cy: 80 },
  armL: { cx: 58, cy: 120 },  // 左臂根（宠物自身左=画面右？这里按画面左命名）
  armR: { cx: 142, cy: 120 },
  legL: { cx: 82, cy: 185 },
  legR: { cx: 118, cy: 185 },
  eyeL: { cx: 86, cy: 78 },
  eyeR: { cx: 114, cy: 78 },
};

/** 构建 SVG DOM，返回 { svg, rig } */
export function buildPet(container, color) {
  const NS = 'http://www.w3.org/2000/svg';
  const c = color || { body: '#4d6efa', belly: '#dbe4ff', ink: '#2b2f45', cheek: '#ff9db0' };

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 220');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  const g = (parent) => { const e = document.createElementNS(NS, 'g'); parent.appendChild(e); return e; };
  const shape = (parent, tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };

  // 层级：body 包住一切；腿在身体下层，手臂在身体上层，头在最上
  const gBody = g(svg);
  const gLegL = g(gBody), gLegR = g(gBody);
  const gTorso = g(gBody);
  const gArmL = g(gBody), gArmR = g(gBody);
  const gHead = g(gBody);
  const gEyeL = g(gHead), gEyeR = g(gHead);

  // —— 腿 ——
  shape(gLegL, 'ellipse', { cx: 82, cy: 192, rx: 12, ry: 15, fill: c.body, stroke: c.ink, 'stroke-width': 3 });
  shape(gLegR, 'ellipse', { cx: 118, cy: 192, rx: 12, ry: 15, fill: c.body, stroke: c.ink, 'stroke-width': 3 });

  // —— 手臂 —— （短胖的椭圆手）
  shape(gArmL, 'ellipse', { cx: 52, cy: 128, rx: 13, ry: 18, fill: c.body, stroke: c.ink, 'stroke-width': 3 });
  shape(gArmR, 'ellipse', { cx: 148, cy: 128, rx: 13, ry: 18, fill: c.body, stroke: c.ink, 'stroke-width': 3 });

  // —— 身体 ——
  shape(gTorso, 'ellipse', { cx: 100, cy: 135, rx: 52, ry: 50, fill: c.body, stroke: c.ink, 'stroke-width': 3.5 });
  shape(gTorso, 'ellipse', { cx: 100, cy: 142, rx: 34, ry: 34, fill: c.belly }); // 肚皮

  // —— 头 ——
  shape(gHead, 'ellipse', { cx: 100, cy: 74, rx: 46, ry: 42, fill: c.body, stroke: c.ink, 'stroke-width': 3.5 });
  // 腮红
  shape(gHead, 'ellipse', { cx: 74, cy: 86, rx: 8, ry: 5, fill: c.cheek, opacity: 0.7 });
  shape(gHead, 'ellipse', { cx: 126, cy: 86, rx: 8, ry: 5, fill: c.cheek, opacity: 0.7 });
  // 嘴
  shape(gHead, 'path', { d: 'M92 92 Q100 99 108 92', fill: 'none', stroke: c.ink, 'stroke-width': 2.5, 'stroke-linecap': 'round' });

  // —— 眼睛（各自一个 <g>，眨眼用 scaleY→0）——
  shape(gEyeL, 'ellipse', { cx: 86, cy: 76, rx: 6, ry: 8, fill: c.ink });
  shape(gEyeL, 'circle', { cx: 88, cy: 73, r: 2, fill: '#fff' });
  shape(gEyeR, 'ellipse', { cx: 114, cy: 76, rx: 6, ry: 8, fill: c.ink });
  shape(gEyeR, 'circle', { cx: 116, cy: 73, r: 2, fill: '#fff' });

  container.appendChild(svg);

  const rig = new Rig({
    body: { el: gBody, ...ANCHORS.body },
    head: { el: gHead, ...ANCHORS.head },
    armL: { el: gArmL, ...ANCHORS.armL },
    armR: { el: gArmR, ...ANCHORS.armR },
    legL: { el: gLegL, ...ANCHORS.legL },
    legR: { el: gLegR, ...ANCHORS.legR },
    eyeL: { el: gEyeL, ...ANCHORS.eyeL },
    eyeR: { el: gEyeR, ...ANCHORS.eyeR },
  });

  return { svg, rig };
}

// —— 动作姿势库 —— 每个动作 = { pose, dur, hold?, loop? }
// pose 给关节目标值；dur 缓动时长；loop 为每帧叠加的周期函数（呼吸/摆动等）。
const breathe = (ph) => ({ body: { ty: Math.sin(ph * 1.6) * 2, sy: 1 + Math.sin(ph * 1.6) * 0.02 } });
const sway = (ph) => ({ body: { rot: Math.sin(ph * 1.4) * 3 }, head: { rot: Math.sin(ph * 1.4 + 0.3) * 4 } });
const bob = (ph) => ({ body: { ty: Math.abs(Math.sin(ph * 6)) * -8 } });

export const POSES = {
  // 待机：站直 + 呼吸
  idle: { pose: {}, dur: 400, loop: breathe },
  // 眨眼卖萌：眼睛压扁
  blink: { pose: { eyeL: { sy: 0.1 }, eyeR: { sy: 0.1 } }, dur: 120, loop: breathe },
  // 挥手（右臂抬起大幅摆）
  wave: { pose: { armR: { rot: -120 }, head: { rot: -5 } }, dur: 300, loop: (ph) => ({ armR: { rot: Math.sin(ph * 12) * 18 } }) },
  // 走：手臂前后小摆 + 身体轻晃
  walk: { pose: {}, dur: 200, loop: (ph) => ({
    armL: { rot: Math.sin(ph * 8) * 25 }, armR: { rot: -Math.sin(ph * 8) * 25 },
    legL: { rot: -Math.sin(ph * 8) * 15 }, legR: { rot: Math.sin(ph * 8) * 15 },
    body: { ty: Math.abs(Math.sin(ph * 8)) * -3 },
  }) },
  // 跳：蹲→弹起（用 loop 做上下）
  jump: { pose: { legL: { sy: 0.7 }, legR: { sy: 0.7 } }, dur: 160, loop: bob },
  // 欢呼：双手举高 + 蹦
  cheer: { pose: { armL: { rot: 130 }, armR: { rot: -130 }, head: { rot: 0 } }, dur: 220, loop: bob },
  // 转圈：整体旋转
  spin: { pose: {}, dur: 200, loop: (ph) => ({ body: { rot: (ph * 180) % 360 } }) },
  // 摇摆舞
  dance: { pose: {}, dur: 250, loop: (ph) => ({
    body: { rot: Math.sin(ph * 5) * 10, ty: Math.abs(Math.sin(ph * 10)) * -4 },
    armL: { rot: Math.sin(ph * 5) * 40 }, armR: { rot: Math.sin(ph * 5) * 40 },
    head: { rot: -Math.sin(ph * 5) * 8 },
  }) },
  // 睡觉：头低垂 + 缓慢呼吸
  sleep: { pose: { head: { rot: 12, ty: 6 }, body: { ty: 4 } }, dur: 500, loop: (ph) => ({ body: { sy: 1 + Math.sin(ph * 0.9) * 0.03, ty: Math.sin(ph * 0.9) * 2 } }) },
  // 害羞：捂脸（双手上抬到头）+ 身体缩
  shy: { pose: { armL: { rot: 90, tx: 6 }, armR: { rot: -90, tx: -6 }, body: { sy: 0.95 } }, dur: 260, loop: sway },
  // 生气：抖动
  angry: { pose: { head: { ty: -3 } }, dur: 120, loop: (ph) => ({ body: { tx: Math.sin(ph * 30) * 3 }, head: { rot: Math.sin(ph * 30) * 3 } }) },
};

// 三种配色（换“宠物”）
export const COLORS = {
  蓝噗: { body: '#4d6efa', belly: '#dbe4ff', ink: '#2b2f45', cheek: '#ff9db0' },
  橘丸: { body: '#f4a45c', belly: '#ffe9d6', ink: '#5a3a1e', cheek: '#ff8a8a' },
  抹茶: { body: '#7fc98f', belly: '#e4f5e6', ink: '#2f4a34', cheek: '#ffb0b0' },
};
