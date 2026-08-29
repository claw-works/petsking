// manifest.js — desktop-pet 姿势 → webm 映射
//
// 原版是 sprite sheet：9 个动画行（idle/running/waving/jumping/failed/waiting/review...），
// AnimationController 按每帧 duration 逐帧播放，idle 每隔 idleFrequencySec 随机换一个变体。
//
// 这里换成 webm：每个 codex pose 配「一组」候选动画，idle 时定期随机切换（复刻 idle 变化机制）。
// pose 是 SEMANTIC_TO_POSE 的值：idle / running / waving / waiting / review / failed。

export const POSE_MANIFEST = {
  // idle 池：原版 idle 每 20s 换一个随机变体，这里放多个候选
  idle: ['待机呼吸休闲', '悠闲哼歌', '哈欠连天', '东张西望', '摇扇纳凉'],
  // running = THINKING/WORKING/CODING/RUNNING_COMMAND 共用（原版就是全映射到 running）
  running: ['写代码', '原地漂浮踏步', '轻快记录'],
  // waving = STARTING 开场挥手
  waving: ['点击回应-元气挥手'],
  // waiting = WAITING_FOR_USER 举手等待
  waiting: ['原地敲击桌面互动'],
  // review = SUCCESS 完成庆祝
  review: ['点击回应-开心跃动'],
  // failed = ERROR 沮丧
  failed: ['玩游戏气急败坏'],
};

// SLEEPING 会走 idle 姿势，但用专门的睡眠动画覆盖（原版是 idle 帧变暗）
export const SLEEP_ANIM = '原地小憩沉眠';

// idle 变体切换间隔（对应原版 idleFrequencySec，默认 20s，这里演示用 6s）
export const IDLE_FREQ_MS = 6000;
