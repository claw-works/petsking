// physics.js — dsh-pet-sprite 物理平台跳跃引擎复刻
//
// 移植自 ChatPet.tsx 的物理常量、scanPlats、plan、jumpTo、update 循环。
//
// 范式：宠物是「平台跳跃游戏角色」。把页面上的消息气泡当作平台，宠物在其上行走、
// 跳跃、下落。有重力/碰撞/支撑判定。自主 AI 会随机规划目标平台并跳过去；点击竞技场
// 背景可接管为玩家控制（A/D 移动，空格跳，双击二段跳），10 秒无输入回自主。
//
// 坐标系：竞技场 (arena) 左下角为原点，x 向右，h（height）向上。

// 物理常量（源自 ChatPet.tsx 第 731-733 行）
export const G = 1500; // 重力 px/s²
export const WALK = 90; // 行走速度 px/s（原版 58，这里调快便于观察）
export const JUMPV = 480; // 一段跳初速
export const SKILLV = 820; // 二段跳初速
export const PW = 120; // 宠物碰撞宽度 px

/** 从 DOM 扫描平台：把 .plat 元素识别为落脚点（对应原版 [data-chat-flow-key] 用户气泡） */
export function scanPlatforms(arena) {
  const ar = arena.getBoundingClientRect();
  const list = [];
  arena.querySelectorAll('.plat').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 70) return;
    // 相对竞技场坐标：y = 从底部往上的高度（平台上表面）
    list.push({
      x1: r.left - ar.left,
      x2: r.right - ar.left,
      y: ar.bottom - r.top, // 平台顶面高度
    });
  });
  return list;
}

/**
 * SpritePhysics：维护宠物 (x, h, vy, state)，每帧 update。
 * state: 'ground' | 'air'
 */
export class SpritePhysics {
  constructor(arena) {
    this.arena = arena;
    this.x = 40;
    this.h = 0; // 距地面高度
    this.vy = 0;
    this.dir = 1; // 1=右, -1=左
    this.state = 'ground';
    this.plat = null; // 当前支撑平台
    this.airJumped = false;

    this.platforms = [];
    this.floorX = 800;
    this.goal = null; // 自主目标 { x, jump? }
    this.planAt = 0;

    this.playerCtl = false;
    this.lastKeyAt = 0;
    this.keys = { left: false, right: false };
    this.moving = false;
    this.dropRequested = false;
  }

  refreshPlatforms() {
    this.platforms = scanPlatforms(this.arena);
    this.floorX = this.arena.getBoundingClientRect().width;
  }

  setControl(on) {
    if (this.playerCtl === on) return;
    this.playerCtl = on;
    if (!on) { this.keys.left = this.keys.right = false; this.planAt = 0; }
    else this.lastKeyAt = performance.now();
  }

  onKey(k, down) {
    this.lastKeyAt = performance.now();
    if (!this.playerCtl) this.setControl(true);
    if (k === 'left' || k === 'right') { this.keys[k] = down; return; }
    if (!down) return;
    if (k === 'jump') this._jumpInput();
    if (k === 'drop') this.dropRequested = true;
  }

  _jumpInput() {
    if (this.state === 'ground') { this.vy = JUMPV; this.state = 'air'; this.airJumped = false; }
    else if (this.state === 'air' && !this.airJumped) { this.airJumped = true; this.vy = Math.max(this.vy, SKILLV * 0.85); }
  }

  /** 反推所需初速，跳向目标平台（源自 jumpTo 第 808-813 行） */
  _jumpTo(p) {
    const need = Math.sqrt(2 * G * Math.max(20, p.y - this.h + 16));
    if (need > SKILLV) return false;
    this.vy = need; this.state = 'air';
    return true;
  }

  /** 自主规划：随机走动或选一个更高平台跳过去（源自 plan 第 899-929 行） */
  _plan(now) {
    this.planAt = now + 1200 + Math.random() * 1800;
    const ups = this.platforms.filter((p) => p.y > this.h + 30 && p.y < this.h + 260);
    const r = Math.random();
    if (r < 0.34 || ups.length === 0) {
      this.goal = { x: 12 + Math.random() * Math.max(20, this.floorX - PW - 32) };
      return;
    }
    const c = ups[Math.floor(Math.random() * ups.length)];
    this.goal = { x: Math.max(c.x1, Math.min(c.x2 - PW, this.x)), jump: c };
  }

  /** 当前平台是否还支撑（源自 support() 第 ~880 行） */
  _support() {
    if (!this.plat) return true;
    for (const p of this.platforms) {
      if (Math.abs(p.y - this.h) < 26 && this.x + PW / 2 > p.x1 - 4 && this.x + PW / 2 < p.x2 + 4) {
        this.plat = p; this.h = p.y; return true;
      }
    }
    return false;
  }

  /** 每帧推进（源自 update 第 876-956 行） */
  update(dt, now) {
    this.moving = false;

    // 10 秒无输入回自主
    if (this.playerCtl && now - this.lastKeyAt > 10_000) this.setControl(false);

    if (this.playerCtl) {
      // 玩家控制：A/D 移动
      if (this.keys.left) { this.x -= WALK * dt; this.dir = -1; this.moving = true; }
      if (this.keys.right) { this.x += WALK * dt; this.dir = 1; this.moving = true; }
    } else {
      // 自主：到点重新规划
      if (now >= this.planAt) this._plan(now);
      if (this.goal) {
        const gx = this.goal.x;
        if (Math.abs(gx - this.x) > 3) {
          this.dir = gx > this.x ? 1 : -1;
          this.x += WALK * dt * this.dir;
          this.moving = true;
        } else if (this.goal.jump) {
          const j = this.goal.jump; this.goal = null; this._jumpTo(j);
        } else {
          this.goal = null;
        }
      }
    }

    // S 键：穿透当前平台下落
    if (this.dropRequested) {
      this.dropRequested = false;
      if (this.state === 'ground' && this.plat && this.plat.y > 0) {
        this.h -= 6; this.state = 'air'; this.vy = 0; this.plat = null;
      }
    }

    // 垂直：重力 + 落地判定
    if (this.state === 'air') {
      const prevH = this.h;
      this.vy -= G * dt;
      this.h += this.vy * dt;
      if (this.vy < 0) { // 下降中，检测落到平台
        for (const p of this.platforms) {
          if (prevH >= p.y && this.h <= p.y && this.x + PW / 2 > p.x1 - 4 && this.x + PW / 2 < p.x2 + 4 && p.y > 2) {
            this.h = p.y; this.vy = 0; this.state = 'ground'; this.plat = p; this.airJumped = false;
            break;
          }
        }
      }
      if (this.h <= 0) { this.h = 0; this.vy = 0; this.state = 'ground'; this.plat = null; this.airJumped = false; }
    } else {
      // 地面：支撑消失则下落
      if (this.h > 0 && !this._support()) { this.state = 'air'; this.vy = 0; this.plat = null; }
    }

    // 水平边界
    this.x = Math.max(0, Math.min(this.floorX - PW, this.x));
  }

  /** 供渲染判断当前应播哪个动画 */
  animState() {
    if (this.state === 'air') return 'air';
    if (this.moving) return 'move';
    return 'ground';
  }
}
