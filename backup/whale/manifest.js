// manifest.js — whale 状态 → webm 动画映射
//
// 对应 whale-on-desk 的 assets/manifest.json（状态→GIF）。这里换成本项目的
// 91 个透明 VP9 webm。缺失状态在 client 里回退到 idle（同源实现）。
//
// scale 对应 whale 的 assets/scale.json：每状态的额外缩放/位移微调（此处从简，
// 只演示机制：可给个别状态不同 scale）。

export const MANIFEST = {
  // durable 工作态
  idle: '待机呼吸休闲',
  'swim-fast': '原地漂浮踏步',
  think: '深度思考碎碎念',
  'tool-run': '写代码',
  review: '轻快记录',
  sleep: '原地小憩沉眠',

  // transient 反应态
  'glass-tap': '原地敲击桌面互动', // 敲玻璃 → 敲桌面
  'poked-flail': '点击回应-傲娇生气',
  startled: '被吓一跳',
  'error-spiral': '玩游戏气急败坏',
  push: '点击回应-元气挥手',
  compact: '照镜子',
  excited: '点击回应-开心跃动',
  'success-streak': '放烟花',
  celebrate: '点击回应-开心跃动',
  proud: '小幅度原地360度旋转展示',
  shy: '点击回应-害羞惊讶',
  'sad-puppy': '打瞌睡被惊醒',
  sink: '原地重力下蹲压缩',
  'token-fountain': '凭空生花',
  greet: '东张西望',
  'chase-fish': '三球抛接',
  eat: '大口吃零食',
  shrimp: '吃西瓜',
  'bubble-ring': '鲸鱼吐泡泡特效',
};

// 每状态渲染微调（scale = 缩放倍数）。未列出的取 1。
export const SCALE = {
  celebrate: { s: 1.05 },
  'glass-tap': { s: 1.0 },
  sleep: { s: 0.98 },
};

// 状态改变时的合成音效参数（对应 client.js playSound）。
// 每项是一串 [freq, startSec, durSec, type, volume] tone。
export const SOUNDS = {
  'poked-flail': [[620, 0, 0.09, 'square', 0.05], [880, 0.07, 0.1, 'square', 0.05]],
  startled: [[620, 0, 0.09, 'square', 0.04], [880, 0.07, 0.1, 'square', 0.04]],
  celebrate: [[660, 0, 0.12, 'triangle', 0.06], [880, 0.1, 0.12, 'triangle', 0.06], [1100, 0.2, 0.16, 'triangle', 0.06]],
  'success-streak': [[660, 0, 0.12, 'triangle', 0.07], [990, 0.12, 0.12, 'triangle', 0.07], [1320, 0.24, 0.18, 'triangle', 0.07]],
  'glass-tap': [[190, 0, 0.06, 'sine', 0.1], [160, 0.12, 0.06, 'sine', 0.1]],
  sink: [[330, 0, 0.15, 'sine', 0.04], [220, 0.12, 0.2, 'sine', 0.04]],
  pet: [[520, 0, 0.16, 'sine', 0.035], [660, 0.12, 0.2, 'sine', 0.035]],
  push: [[880, 0, 0.1, 'triangle', 0.05], [1320, 0.1, 0.14, 'triangle', 0.05]],
};
