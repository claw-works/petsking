// pet.js — standalone (no React / no Cordis / no DSH server) driver for the
// dsh-pet animation assets. Logic ported 1:1 from dsh-pet's
// src/client/{pickers.ts, motion.ts, pet.ts}, rewritten against plain DOM APIs.
//
// Reads assets/config.jsonc (same file shipped inside the dsh-pet npm package)
// and assets/thumb/*.webm (the 91 transparent VP9-alpha animations), and drives
// one <div class="dsh-pet-root"> per entry in config.pets with the same
// probability-driven "never-ending animation chain" behaviour as the plugin.

const CANVAS_H = 360; // thumb canvas height (px) — geometry constant, matches source assets
const FEET_Y = 330; // "foot line" y on the 640x360 canvas — every animation stands on this line
const HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 }; // click/drag hit rect in 640x360 canvas coords
const DRAG_THRESHOLD = 5; // px pointer must move before a click turns into a drag
const THUMB_BASE = 'assets/thumb/';

// ------------------------- pure helpers (pickers.ts) -------------------------

/** Pick uniformly at random from pool; exclude avoids immediate repeats. */
function pick(pool, exclude) {
  const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
  const src = entries.length ? entries : pool;
  return src[Math.floor(Math.random() * src.length)];
}

/** Random integer in [min, max). */
function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

/** Pick a category by weight; noMirror categories are excluded when facing='right'. */
function pickWeightedCategory(categories, facing) {
  const cats = categories.filter((c) => c.actions.length > 0);
  if (!cats.length) return null;
  const filtered = cats.filter((c) => !(c.noMirror && facing === 'right'));
  const eligible = filtered.length ? filtered : cats;
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1;
  let t = Math.random() * totalW;
  for (const c of eligible) {
    t -= c.weight;
    if (t <= 0) return c;
  }
  return eligible[eligible.length - 1];
}

/** Weighted dice roll -> next animation-chain kind. */
function rollKind(roll, w) {
  const topEnd = (w.idle + w.turn + w.move) / 100;
  if (roll < w.idle / 100) return 'idle';
  if (roll < (w.idle + w.turn) / 100) return 'turn';
  if (roll < topEnd) return 'move';
  return 'action';
}

/** Pick one action name from the weighted category pool (falls back to idle pool). */
function pickCategoryAction(categories, idlePool, facing, current) {
  const cat = pickWeightedCategory(categories, facing);
  if (!cat) return { id: 'FALLBACK', name: pick(idlePool, current) };
  return { id: cat.id, name: pick(cat.actions, current) };
}

// ------------------------- pure helpers (motion.ts) -------------------------

/** Compute a walk's start/target ratio coords; returns null if it would leave the viewport. */
function planMove(o) {
  const distance = randomBetween(o.minDist, o.maxDist);
  const target = o.cx + o.dir * distance;
  const leftBound = o.margin + o.halfW;
  const rightBound = o.W - o.margin - o.halfW;
  if (target < leftBound || target > rightBound) return null;
  return {
    startRatio: o.cx / o.W,
    startYRatio: o.cy / o.H,
    targetRatio: target / o.W,
    totalRatio: Math.abs(target - o.cx) / o.W,
  };
}

// ------------------------- config loading -------------------------

/** Strip JSONC comments (// line, /* block *​/) so JSON.parse can read it. */
function stripJsonc(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1')
    .trim();
}

async function loadConfig() {
  const res = await fetch('assets/config.jsonc');
  if (!res.ok) throw new Error('config.jsonc HTTP ' + res.status);
  const text = await res.text();
  return JSON.parse(stripJsonc(text));
}

// ------------------------- CSS (same rules as pet.ts) -------------------------

const CSS = `
.dsh-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}
.dsh-pet-root[data-corner="bottom-right"]{right:var(--dsh-pet-mx,24px);bottom:var(--dsh-pet-my,0)}
.dsh-pet-root[data-corner="bottom-left"]{left:var(--dsh-pet-mx,24px);bottom:var(--dsh-pet-my,0)}
.dsh-pet-root[data-corner="top-right"]{right:var(--dsh-pet-mx,24px);top:var(--dsh-pet-my,0)}
.dsh-pet-root[data-corner="top-left"]{left:var(--dsh-pet-mx,24px);top:var(--dsh-pet-my,0)}
.dsh-pet-stage{position:relative;width:var(--dsh-pet-size,462px);height:calc(var(--dsh-pet-size,462px)*9/16);pointer-events:none}
.dsh-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;opacity:0;transition:opacity .18s ease;transform-origin:center}
.dsh-pet-video.is-front{opacity:1}
.dsh-pet-hit{position:absolute;pointer-events:auto;cursor:default;z-index:1}
.dsh-pet-hit.dragging{cursor:grabbing}
@media (prefers-reduced-motion: reduce){.dsh-pet-video{transition:none}}
`;

function injectCss() {
  if (document.querySelector('style[data-pet-css]')) return;
  const tag = document.createElement('style');
  tag.dataset.petCss = '1';
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

// ------------------------- Pet: one instance per config.pets[i] -------------------------

class Pet {
  constructor(cfg, animations, weights, log) {
    this.cfg = cfg;
    this.animations = animations;
    this.weights = weights;
    this.log = log || (() => {});

    this.size = cfg.size;
    this.halfW = this.size / 2;
    this.halfH = (this.size * 9) / 16 / 2;

    this.anim = animations.idle[0] ?? '';
    this.once = true;
    this.facing = 'left';
    this.dragging = false;
    this.customPos = null; // {rx, ry} viewport-ratio coords once moved/dropped once
    this.corner = cfg.position.corner;
    this.margin = { x: cfg.position.marginX, y: cfg.position.marginY };

    this.frontIndex = 0; // which <video> is currently visible
    this.pending = null; // {anim, once, gen} in-flight switch
    this.gen = 0;

    this.dragState = { active: false, dragging: false, sx: 0, sy: 0, offX: 0, offY: 0 };
    this.justDragged = false;

    this.moveRAF = null;
    this.moveToken = 0;
    this.pendingMove = null;

    this._buildDom();
    this._bindEvents();
    this._applyStyleVars();
    this.switchTo(this.anim, this.once);

    window.addEventListener('resize', () => this._applyRootStyle());
  }

  _buildDom() {
    const root = document.createElement('div');
    root.className = 'dsh-pet-root';
    root.dataset.corner = this.corner;
    root.dataset.facing = this.facing;

    const stage = document.createElement('div');
    stage.className = 'dsh-pet-stage';

    const videoA = document.createElement('video');
    videoA.className = 'dsh-pet-video is-front';
    const videoB = document.createElement('video');
    videoB.className = 'dsh-pet-video';
    for (const v of [videoA, videoB]) {
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.title = 'dsh-pet';
    }

    const hit = document.createElement('div');
    hit.className = 'dsh-pet-hit';
    hit.title = 'dsh-pet';
    hit.style.left = (HIT_BOX.x0 / 640) * 100 + '%';
    hit.style.top = (HIT_BOX.y0 / 360) * 100 + '%';
    hit.style.width = ((HIT_BOX.x1 - HIT_BOX.x0) / 640) * 100 + '%';
    hit.style.height = ((HIT_BOX.y1 - HIT_BOX.y0) / 360) * 100 + '%';

    stage.appendChild(videoA);
    stage.appendChild(videoB);
    stage.appendChild(hit);
    root.appendChild(stage);
    document.body.appendChild(root);

    this.root = root;
    this.stage = stage;
    this.videoA = videoA;
    this.videoB = videoB;
    this.hit = hit;
  }

  _applyStyleVars() {
    this.root.style.setProperty('--dsh-pet-size', this.size + 'px');
    this.root.style.setProperty('--dsh-pet-mx', this.margin.x + 'px');
    this.root.style.setProperty('--dsh-pet-my', this.margin.y + 'px');
    this._applyBottomPad();
    this._applyRootStyle();
  }

  /** Foot-line alignment: shift the stage down so every animation's feet share y=FEET_Y. */
  _applyBottomPad() {
    const bottomPad = (this.size * (9 / 16) * (CANVAS_H - FEET_Y)) / CANVAS_H;
    this.bottomPad = bottomPad;
    this.stage.style.transform = this.dragging ? 'none' : 'translateY(' + bottomPad + 'px)';
  }

  _applyRootStyle() {
    if (!this.customPos) {
      this.root.style.left = '';
      this.root.style.top = '';
      this.root.style.right = '';
      this.root.style.bottom = '';
      return;
    }
    const rx = this.customPos.rx;
    const ry = this.customPos.ry;
    const left = Math.min(Math.max(rx * window.innerWidth - this.halfW, 0), window.innerWidth - this.size);
    const top = Math.min(
      Math.max(ry * window.innerHeight - this.halfH, 0),
      window.innerHeight - (this.size * 9) / 16,
    );
    this.root.style.left = left + 'px';
    this.root.style.top = top + 'px';
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
  }

  /** Double-buffered cross-fade switch to a new animation (mirrors pet.ts switchTo). */
  switchTo(next, nextOnce) {
    if (!next) return;
    if (this.pending && this.pending.anim === next && this.pending.once === nextOnce) return;
    const gen = ++this.gen;
    this.pending = { anim: next, once: nextOnce, gen };
    const el = this.frontIndex === 0 ? this.videoB : this.videoA;
    el.src = THUMB_BASE + encodeURIComponent(next) + '.webm';
    el.loop = !nextOnce;
    el.onended = nextOnce ? () => this.handleEnded() : null;
    el.load();
    const onReady = () => {
      el.removeEventListener('loadeddata', onReady);
      if (!this.pending || this.pending.gen !== gen) return;
      const old = this.frontIndex === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old && old !== el) old.classList.remove('is-front');
      this.frontIndex = this.frontIndex === 0 ? 1 : 0;
      this.pending = null;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play().catch(() => {});
      if (this.pendingMove) this.startMoveDrive(el);
    };
    el.addEventListener('loadeddata', onReady);
    if (el.readyState >= 2) onReady();
    this.anim = next;
    this.once = nextOnce;
  }

  /** Weighted dice: pick + play the next link in the never-ending animation chain. */
  pickNext() {
    const { animations, weights } = this;
    const roll = Math.random();
    const k = rollKind(roll, weights);
    let kind;
    let next;
    let moved = false;
    if (k === 'idle') {
      kind = 'IDLE';
      next = pick(animations.idle, this.anim);
    } else if (k === 'turn') {
      kind = 'TURN';
      next = pick(animations.turn, this.anim);
    } else if (k === 'move') {
      moved = this.tryMove();
      if (moved) {
        kind = 'MOVES';
        next = '移动(池内随机)';
      } else {
        const act = pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
        kind = act.id;
        next = act.name;
      }
    } else {
      const act = pickCategoryAction(animations.categories, animations.idle, this.facing, this.anim);
      kind = act.id;
      next = act.name;
    }
    this.log(this.cfg.id, this.facing, roll, kind, next);
    if (!moved) this.switchTo(next, true);
  }

  /** Fires when a non-looping ("once") animation finishes. */
  handleEnded() {
    const { animations } = this;
    if (this.dragState.active) return; // frozen last-frame while actively dragging
    if (animations.turn.includes(this.anim)) {
      this.facing = this.facing === 'left' ? 'right' : 'left';
      this.root.dataset.facing = this.facing;
    }
    if (animations.drag.includes(this.anim) || animations.clicks.includes(this.anim)) {
      if (animations.idle.length) this.switchTo(pick(animations.idle, this.anim), true);
      return;
    }
    this.pickNext();
  }

  // ---- movement (screen wandering) ----

  currentCenterX() {
    if (this.customPos) return this.customPos.rx * window.innerWidth;
    const r = this.root.getBoundingClientRect();
    return r.left + this.halfW;
  }
  currentCenterY() {
    if (this.customPos) return this.customPos.ry * window.innerHeight;
    const r = this.root.getBoundingClientRect();
    return r.top + this.halfH;
  }

  tryMove() {
    if (this.moveRAF !== null || this.pendingMove) return true;
    const moves = this.animations.moves;
    const actions = moves.actions;
    if (!actions.length) return false;
    const chosen = actions[Math.floor(Math.random() * actions.length)];
    const mp = Object.assign({}, moves.default, chosen.params || {});
    const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;
    const plan = planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),
      W: window.innerWidth,
      H: window.innerHeight,
      dir,
      minDist: mp.minDist,
      maxDist: mp.maxDist,
      margin: mp.margin,
      halfW: this.halfW,
    });
    if (!plan) return false;
    this.pendingMove = { ...plan, dir, leadSec: mp.leadSec, tailSec: mp.tailSec };
    this.switchTo(chosen.name, true);
    return true;
  }

  /** Drive the walk by reading the playing video's currentTime each rAF tick. */
  startMoveDrive(el) {
    const pm = this.pendingMove;
    if (!pm || this.moveRAF !== null) return;
    this.pendingMove = null;
    const { startRatio, startYRatio, targetRatio, dir, totalRatio, leadSec, tailSec } = pm;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
    const travelWindow = Math.max(0.1, duration - leadSec - tailSec);
    const token = ++this.moveToken;
    const step = () => {
      if (this.moveToken !== token) return;
      const t = el.currentTime || 0;
      const W = window.innerWidth;
      const H = window.innerHeight;
      let ratioX;
      if (t <= leadSec) ratioX = startRatio;
      else if (t >= duration - tailSec) ratioX = targetRatio;
      else ratioX = startRatio + dir * totalRatio * ((t - leadSec) / travelWindow);
      const px = ratioX * W;
      const py = startYRatio * H;
      this.root.style.left = px - this.halfW + 'px';
      this.root.style.top = py - this.halfH + 'px';
      this.root.style.right = 'auto';
      this.root.style.bottom = 'auto';
      if (t < duration - tailSec) this.moveRAF = requestAnimationFrame(step);
      else {
        this.moveRAF = null;
        this.customPos = { rx: targetRatio, ry: startYRatio };
      }
    };
    this.moveRAF = requestAnimationFrame(step);
  }

  stopMove() {
    this.pendingMove = null;
    this.moveToken++;
    if (this.moveRAF !== null) {
      cancelAnimationFrame(this.moveRAF);
      this.moveRAF = null;
    }
  }

  // ---- pointer events: click vs drag ----

  _bindEvents() {
    const hit = this.hit;
    hit.addEventListener('mouseenter', () => {
      if (!this.dragState.active) hit.style.cursor = 'grab';
    });
    hit.addEventListener('mouseleave', () => {
      if (!this.dragState.active) hit.style.cursor = 'default';
    });
    hit.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    hit.addEventListener('pointermove', (e) => this.onPointerMove(e));
    hit.addEventListener('pointerup', (e) => this.onPointerUp(e));
    hit.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    hit.addEventListener('click', () => this.onClick());
  }

  onPointerDown(e) {
    this.hit.classList.add('dragging');
    this.stopMove();
    this.hit.setPointerCapture(e.pointerId);
    const rr = this.root.getBoundingClientRect();
    const offX = e.clientX - (rr.left + rr.width / 2);
    const offY = e.clientY - (rr.top + rr.height / 2);
    this.dragState = { active: true, dragging: false, sx: e.clientX, sy: e.clientY, offX, offY };
  }

  onPointerMove(e) {
    const d = this.dragState;
    if (!d.active) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.dragging = true;
      this.dragging = true;
      this._applyBottomPad(); // drops the translateY pad while mid-drag
      if (this.animations.drag.length) this.switchTo(pick(this.animations.drag), true);
    }
    this.root.style.left = e.clientX - d.offX - this.halfW + 'px';
    this.root.style.top = e.clientY - d.offY - this.halfH + 'px';
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    this.stage.style.transform = 'none';
  }

  onPointerUp(e) {
    const d = this.dragState;
    const wasDragging = d.dragging;
    d.active = false;
    d.dragging = false;
    this.hit.classList.remove('dragging');
    if (wasDragging) {
      this.justDragged = true;
      setTimeout(() => (this.justDragged = false), 100);
      this.dragging = false;
      this.customPos = {
        rx: (e.clientX - d.offX) / window.innerWidth,
        ry: (e.clientY - d.offY) / window.innerHeight,
      };
      this._applyRootStyle();
      this.stage.style.transform = 'translateY(' + this.bottomPad + 'px)';
      // Dropped: rest in a *looping* idle (once=false) — chain stays paused until clicked.
      if (this.animations.idle.length) this.switchTo(pick(this.animations.idle, this.anim), false);
    }
  }

  onClick() {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged) return;
    if (this.once && !this.animations.idle.includes(this.anim)) return;
    this.stopMove();
    if (this.animations.clicks.length) this.switchTo(pick(this.animations.clicks), true);
  }
}

// ------------------------- bootstrap -------------------------

function defaultLogger(id, facing, roll, kind, next) {
  const line =
    new Date().toTimeString().slice(0, 8) +
    ' pet=' + id + ' facing=' + facing + ' roll=' + roll.toFixed(4) + ' -> [' + kind + '] ' + next;
  console.log('[pet-study] ' + line);
  const hud = document.getElementById('pet-log');
  if (hud) {
    const row = document.createElement('div');
    row.textContent = line;
    hud.insertBefore(row, hud.firstChild);
    while (hud.childElementCount > 12) hud.removeChild(hud.lastChild);
  }
}

async function main() {
  injectCss();
  const cfg = await loadConfig();
  const weights = cfg.animationWeights;
  const animations = cfg.animations;
  const pets = cfg.pets.map((petCfg) => new Pet(petCfg, animations, weights, defaultLogger));
  window.__pets = pets; // expose for console poking, e.g. window.__pets[0].pickNext()
}

main().catch((e) => {
  console.error('[pet-study] failed to init pet:', e);
  const hud = document.getElementById('pet-log');
  if (hud) hud.textContent = 'load failed: ' + e.message;
});
