# GLTF 3D 角色皮肤（清霄）+ 通用表情/手势/语音 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 pet-lib 加 `gltf` 渲染器与渲染器无关的表情 / 头部手势 / 语音（含音频驱动口型、可插拔 TTS）能力，接入清霄素材包，并打通 playground、dashboard、Agent 状态机与 /chat。

**Architecture:** 渲染器只负责画（clip、表情 morph、口型 morph、程序化手势）；`pet-lib/voice/` 独立负责音频播放、口型特征与 TTS，把口型帧推给当前渲染器；驱动/意图输出统一的「表演」对象 `{action, expression, gesture, voice}`，由 DeskPet 分发。three 及 GLTF 相关模块全部动态 import，非 3D 页面不受影响。

**Tech Stack:** 纯 ESM（零构建）、three@0.170（importmap / 可选 peer）、WebAudio、speechSynthesis、Bun（server + `bun test`）。

**Spec:** `docs/superpowers/specs/2026-10-13-gltf-character-skin-design.md`

**约定：**
- 所有命令在仓库根 `/Users/wellxie/projects/claw-works/petsking` 执行。
- 纯逻辑单测用 `bun test`，测试文件与源文件同目录、`*.test.js` 命名（与 `server/` 现有风格一致）。
- 清霄源仓库：`/Users/wellxie/projects/tmp/qingxiao-pet`（下称 QX）。
- 做的过程中发现需要**改模型数据**（GLB、材质、动画、语音包）的地方，追加到 `docs/model-change-requests.md`（Task 1 创建），用户会同步到模型制作仓库。

---

## 文件结构

**新建**
| 文件 | 职责 |
|---|---|
| `pet-lib/package.json` | 包声明（exports、three 可选 peer） |
| `pet-lib/core/performance.js` (+test) | 解析「表演」值（字符串 / 对象） |
| `pet-lib/voice/visemes.js` (+test) | viseme 表、字符→viseme、按字估算时间线 |
| `pet-lib/voice/mouth-features.js` (+test) | 一帧音频数据 → `{open, wide, round}`（纯函数） |
| `pet-lib/voice/lipsync.js` | WebAudio 播放 + 分析（移植 QX，支持 Blob/ArrayBuffer） |
| `pet-lib/voice/voice-pack.js` (+test) | 加载语音包 index.json、按 id 取台词、解析 URL |
| `pet-lib/voice/tts.js` | TTS provider 接口 + 默认浏览器 TTS |
| `pet-lib/voice/voice.js` | `Voice`：调度音频/TTS，逐帧把口型推给渲染器 |
| `pet-lib/voice/index.js` | 语音层出口 |
| `pet-lib/renderers/gltf-math.js` (+test) | 相机取景、每米像素、步速换算（纯函数） |
| `pet-lib/renderers/gesture-curves.js` (+test) | 手势曲线与淡入淡出（纯函数） |
| `pet-lib/renderers/_springbones.js` | 弹簧骨骼（QX 原样拷贝） |
| `pet-lib/renderers/_gltf-character.js` | `Character`：clip、表情、眨眼、blush、fur、口型、转身 |
| `pet-lib/renderers/_gltf-gestures.js` | `GestureLayer`：把手势曲线加性叠加到骨骼 |
| `pet-lib/renderers/gltf.js` | `GltfRenderer`（注册 `gltf`） |
| `pets/qingxiao/pet.json` / `soul.md` / `README.md` | 清霄素材包 |
| `tools/sync-qingxiao-assets.sh` | 从 QX 拷贝模型与语音到 `pets/qingxiao/assets/` |
| `docs/model-change-requests.md` | 模型数据修改需求记录 |

**修改**
`package.json`、`pet-lib/renderers/renderer-base.js`、`pet-lib/renderers/index.js`、`pet-lib/core/chain-driver.js`、`pet-lib/core/state-driver.js`、`pet-lib/ai/agent-bridge.js`、`pet-lib/config.js`、`pet-lib/pet.js`、`pet-lib/index.js`、`pets/index.json`、`server/pet-registry.js`(+test)、`dashboard/dashboard.js`、`playground/index.html`、`playground/playground.js`、`chat/index.html`、`chat/chat.js`、`chat/chat.css`、`pet-lib/README.md`、`README.md`、spec。

---

### Task 1: 包声明、测试脚本、模型修改记录

**Files:**
- Create: `pet-lib/package.json`
- Create: `docs/model-change-requests.md`
- Modify: `package.json`

- [ ] **Step 1: 创建 `pet-lib/package.json`**

```json
{
  "name": "@claw-works/pet-lib",
  "version": "0.1.0",
  "description": "渲染无关、驱动可插拔、程序与素材分离的桌宠 / 角色皮肤库",
  "type": "module",
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./voice": "./voice/index.js"
  },
  "peerDependencies": { "three": ">=0.160.0" },
  "peerDependenciesMeta": { "three": { "optional": true } },
  "license": "MIT"
}
```

- [ ] **Step 2: 根 `package.json` 的 test 脚本覆盖 pet-lib**

把 `"test": "bun test server"` 改为：

```json
    "test": "bun test server pet-lib"
```

- [ ] **Step 3: 创建 `docs/model-change-requests.md`**

```markdown
# 模型数据修改需求（同步到清霄模型制作仓库）

petsking 接入清霄时发现的、更适合在模型 / 素材侧修正的问题。代码里目前有对应的兜底处理，
模型侧修好后可以删掉兜底。每条：现象 → 期望 → 代码兜底位置。

| # | 日期 | 对象 | 现象 | 期望 | 代码兜底 |
|---|---|---|---|---|---|
| 1 | 2026-10-13 | 材质 Down / Cloth | glTF 标为 `MASK`，但 base color 的 alpha 通道是无意义的低值数据（均值 ~0.18），按 MASK 渲染会挖出大洞 | 导出为 `OPAQUE`，或清空 alpha 通道 | `_gltf-character.js` `fixMaterials()` 强制不透明 |
| 2 | 2026-10-13 | 材质 Bangs / Hair | glTF 标为 `OPAQUE`，但 alpha 是真实的发丝镂空 | 导出为 `MASK`、`alphaCutoff≈0.35`、`doubleSided: true` | `fixMaterials()` 设 alphaTest 0.35 + DoubleSide |
| 3 | 2026-10-13 | 全部动画 | `Root` 骨骼带 translation 轨道，循环边界会跳 | 导出原地动画（去掉 Root.position），位移速度写进清单 | `Character` 构造时过滤 `Root.position` 轨道 |
| 4 | 2026-10-13 | 场景单位 | 模型以 cm 制作，需要在代码里 `scale 0.01` | 导出时换算到米 | `Character` 构造时 `root.scale.setScalar(0.01)` |
| 5 | 2026-10-13 | 动画库 | 只有待机/小动作/走/跑，Agent 状态只能靠表情 + 程序化头部手势区分 | （后续）补 挥手 / 欢呼 / 思考托腮 / 敲键盘 等上身 clip | 无，加 clip 后只改 `pets/qingxiao/pet.json` |
```

- [ ] **Step 4: 确认测试仍全绿**

Run: `bun test server pet-lib`
Expected: 现有 server 测试全部 PASS（pet-lib 下暂无测试文件）。

- [ ] **Step 5: Commit**

```bash
git add pet-lib/package.json package.json docs/model-change-requests.md
git commit -m "chore(pet-lib): 加 package.json；测试覆盖 pet-lib；新建模型修改需求记录"
```

---

### Task 2: 「表演」解析 `resolvePerformance`

**Files:**
- Create: `pet-lib/core/performance.js`
- Test: `pet-lib/core/performance.test.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/core/performance.test.js
import { test, expect } from 'bun:test';
import { resolvePerformance, performanceMeta } from './performance.js';

test('字符串 = 只有动作（旧格式兼容）', () => {
  expect(resolvePerformance('wave')).toEqual({ action: 'wave' });
});

test('对象：保留 action/expression/gesture/voice/say/holdMs', () => {
  const p = resolvePerformance({ action: 'idle', expression: 'sad', gesture: 'lookDown', voice: 'error', say: '哎', holdMs: 1500, junk: 1 });
  expect(p).toEqual({ action: 'idle', expression: 'sad', gesture: 'lookDown', voice: 'error', say: '哎', holdMs: 1500 });
});

test('对象可以没有 action（只换表情）', () => {
  expect(resolvePerformance({ expression: 'smile' })).toEqual({ action: null, expression: 'smile' });
});

test('空值 / 空对象 / 非法类型 → null', () => {
  expect(resolvePerformance(null)).toBe(null);
  expect(resolvePerformance(undefined)).toBe(null);
  expect(resolvePerformance('')).toBe(null);
  expect(resolvePerformance({})).toBe(null);
  expect(resolvePerformance(42)).toBe(null);
});

test('performanceMeta 去掉 action，其余并入驱动 meta', () => {
  expect(performanceMeta({ action: 'idle', expression: 'sad', voice: 'error' })).toEqual({ expression: 'sad', voice: 'error' });
  expect(performanceMeta(null)).toEqual({});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/core/performance.test.js`
Expected: FAIL（`Cannot find module './performance.js'`）

- [ ] **Step 3: 实现**

```js
// pet-lib/core/performance.js — 「表演」解析
//
// 素材包里 stateActions / intentMap / chain.clicks 的值可以是：
//   "wave"                                              只播动作（旧格式）
//   { action, expression, gesture, voice, say, holdMs } 动作 + 表情 + 头部手势 + 预录语音 + 气泡
// 解析成统一对象交给 DeskPet 分发；渲染器不支持的部分会被忽略。

const EXTRA_KEYS = ['expression', 'gesture', 'voice', 'say'];

export function resolvePerformance(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return { action: value };
  if (typeof value !== 'object') return null;
  const out = { action: value.action || null };
  for (const k of EXTRA_KEYS) if (value[k]) out[k] = value[k];
  if (value.holdMs != null) out.holdMs = value.holdMs;
  if (!out.action && !EXTRA_KEYS.some((k) => out[k])) return null;
  return out;
}

/** 表演里除 action 以外的字段，并入驱动 onAction 的 meta */
export function performanceMeta(perf) {
  if (!perf) return {};
  const { action, ...rest } = perf;
  return rest;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/core/performance.test.js`
Expected: 5 pass

- [ ] **Step 5: Commit**

```bash
git add pet-lib/core/performance.js pet-lib/core/performance.test.js
git commit -m "feat(pet-lib): resolvePerformance 统一解析表演对象"
```

---

### Task 3: 驱动输出表演 meta（StateDriver / ChainDriver.click）

**Files:**
- Modify: `pet-lib/core/state-driver.js`（`_emitState`）
- Modify: `pet-lib/core/chain-driver.js`（`click`）
- Test: `pet-lib/core/drivers.test.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/core/drivers.test.js
import { test, expect } from 'bun:test';
import { StateDriver } from './state-driver.js';
import { ChainDriver } from './chain-driver.js';

function capture(driver) {
  const calls = [];
  driver.onAction((action, meta) => calls.push([action, meta]));
  return calls;
}

test('StateDriver：对象形式的 stateActions 把 expression/gesture/voice 放进 meta', () => {
  const d = new StateDriver({ stateActions: { THINKING: { action: 'idle', expression: 'neutral', gesture: 'tilt', voice: 'thinking' } } });
  const calls = capture(d);
  d.feed({ type: 'agent.thinking' });
  expect(calls.at(-1)).toEqual(['idle', { loop: true, kind: 'THINKING', expression: 'neutral', gesture: 'tilt', voice: 'thinking' }]);
  d.stop();
});

test('StateDriver：字符串形式保持旧行为', () => {
  const d = new StateDriver({ stateActions: { THINKING: 'nod' } });
  const calls = capture(d);
  d.feed({ type: 'agent.thinking' });
  expect(calls.at(-1)).toEqual(['nod', { loop: true, kind: 'THINKING' }]);
  d.stop();
});

test('StateDriver：对象没有 action 时回落 idleAction', () => {
  const d = new StateDriver({ stateActions: { ERROR: { expression: 'sad' } }, idleAction: 'idle' });
  const calls = capture(d);
  d.feed({ type: 'task.failed' });
  expect(calls.at(-1)[0]).toBe('idle');
  expect(calls.at(-1)[1].expression).toBe('sad');
  d.stop();
});

test('ChainDriver.click：对象形式的 clicks', () => {
  const d = new ChainDriver({ clicks: [{ action: 'fidget-2', expression: 'smile', voice: 'hello' }] });
  const calls = capture(d);
  d.click();
  expect(calls.at(-1)).toEqual(['fidget-2', { loop: false, kind: 'CLICK', expression: 'smile', voice: 'hello' }]);
  d.stop();
});

test('ChainDriver.click：字符串形式保持旧行为', () => {
  const d = new ChainDriver({ clicks: ['click-happy'] });
  const calls = capture(d);
  d.click();
  expect(calls.at(-1)).toEqual(['click-happy', { loop: false, kind: 'CLICK' }]);
  d.stop();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/core/drivers.test.js`
Expected: 对象形式的 3 个用例 FAIL（action 是对象 / meta 缺字段），字符串用例 PASS。

- [ ] **Step 3: 改 `state-driver.js`**

在文件顶部 import 行后加：

```js
import { resolvePerformance, performanceMeta } from './performance.js';
```

把 `_emitState` 最后两行：

```js
    const action = this.stateActions[state] || this.idleAction;
    this._emit(action, { loop: true, kind: state });
```

替换为：

```js
    // stateActions 的值可以是动作名或表演对象 { action, expression, gesture, voice }
    const perf = resolvePerformance(this.stateActions[state]) || { action: this.idleAction };
    this._emit(perf.action || this.idleAction, { loop: true, kind: state, ...performanceMeta(perf) });
```

并把文件头注释 `stateActions: { SEMANTIC: actionName }   状态→动作映射（来自素材包）` 改为
`stateActions: { SEMANTIC: actionName | 表演对象 }   状态→动作映射（来自素材包，见 performance.js）`。

- [ ] **Step 4: 改 `chain-driver.js`**

顶部 import 后加：

```js
import { resolvePerformance, performanceMeta } from './performance.js';
```

把 `click()` 整个方法替换为：

```js
  click() {
    if (!this.clicks.length) return;
    // clicks 里可以是动作名或表演对象 { action, expression, gesture, voice }
    const perf = resolvePerformance(pick(this.clicks));
    if (!perf || !perf.action) return;
    this._emit(perf.action, { loop: false, kind: 'CLICK', ...performanceMeta(perf) });
    if (this.timer) clearTimeout(this.timer);
    if (!this.paused) this.timer = setTimeout(() => this.pickNext(), this._ms(perf.action));
  }
```

- [ ] **Step 5: 运行确认通过**

Run: `bun test pet-lib`
Expected: drivers 5 pass + performance 5 pass

- [ ] **Step 6: Commit**

```bash
git add pet-lib/core/state-driver.js pet-lib/core/chain-driver.js pet-lib/core/drivers.test.js
git commit -m "feat(pet-lib): 状态机与点击回应支持表演对象（表情/手势/语音）"
```

---

### Task 4: viseme 表与按字估算时间线

**Files:**
- Create: `pet-lib/voice/visemes.js`
- Test: `pet-lib/voice/visemes.test.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/voice/visemes.test.js
import { test, expect } from 'bun:test';
import { VISEMES, charToViseme, textToVisemeTimeline, visemeAt } from './visemes.js';

test('拉丁字母映射', () => {
  expect(charToViseme('a')).toBe('A');
  expect(charToViseme('O')).toBe('O');
  expect(charToViseme('m')).toBe('M');
  expect(charToViseme('s')).toBe('S');
  expect(charToViseme(' ')).toBe('rest');
});

test('汉字映射到元音口型且确定（同字同口型）', () => {
  const v = charToViseme('好');
  expect(['A', 'E', 'I', 'O', 'U']).toContain(v);
  expect(charToViseme('好')).toBe(v);
});

test('标点 = rest', () => {
  expect(charToViseme('，')).toBe('rest');
  expect(charToViseme('。')).toBe('rest');
  expect(charToViseme('…')).toBe('rest');
});

test('每个 viseme 名都在表里', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz 你好，') expect(VISEMES[charToViseme(ch)]).toBeDefined();
});

test('时间线：每字一段 + 收尾 rest，时长可预期', () => {
  const tl = textToVisemeTimeline('你好', () => 0); // 固定随机 → 每字 75ms
  expect(tl.events.length).toBe(3);
  expect(tl.events[0]).toEqual({ t: 0, viseme: charToViseme('你'), dur: 0.075 });
  expect(tl.events[2].viseme).toBe('rest');
  expect(tl.duration).toBeCloseTo(0.15 + 0.35, 5);
});

test('空文本 → 空时间线', () => {
  expect(textToVisemeTimeline('')).toEqual({ events: [], duration: 0 });
});

test('visemeAt 取当前时刻口型，越界 rest', () => {
  const tl = textToVisemeTimeline('ab', () => 0);
  expect(visemeAt(tl, 0.01)).toBe('A');
  expect(visemeAt(tl, 0.1)).toBe('M');
  expect(visemeAt(tl, 9)).toBe('rest');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/voice/visemes.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// pet-lib/voice/visemes.js — 口型（viseme）表 + 按字估算口型时间线（纯函数）
//
// 用在拿不到音频数据的场合（如浏览器 TTS 自己出声）：按字符粗略排一条口型时间线。
// 有音频数据时走 lipsync（mouth-features.js），更准。
// VISEMES 的 morph 名对应清霄 GLB 的嘴型 morph：Aa E I O U M_OpenSmall。

export const VISEMES = {
  rest: {},
  A: { Aa: 0.85 },
  E: { E: 0.7 },
  I: { I: 0.7 },
  O: { O: 0.8 },
  U: { U: 0.8 },
  M: { M_OpenSmall: 0.15 },           // 闭唇辅音 m/b/p
  S: { M_OpenSmall: 0.35, E: 0.25 },  // s/z/c
  N: { M_OpenSmall: 0.4, Aa: 0.2 },
  F: { M_OpenSmall: 0.3 },
};

const HAN_VOWELS = ['A', 'E', 'I', 'O', 'U'];
const PUNCT_RE = /[\s\p{P}\p{S}]/u;

export function charToViseme(ch) {
  if (/\p{Script=Han}/u.test(ch)) return HAN_VOWELS[ch.codePointAt(0) % HAN_VOWELS.length];
  const c = ch.toLowerCase();
  if ('aàáâä'.includes(c)) return 'A';
  if ('eèéêë'.includes(c)) return 'E';
  if ('iìíîïy'.includes(c)) return 'I';
  if ('oòóôö'.includes(c)) return 'O';
  if ('uùúûüw'.includes(c)) return 'U';
  if ('mbp'.includes(c)) return 'M';
  if ('szcxj'.includes(c)) return 'S';
  if ('nrltd'.includes(c)) return 'N';
  if ('fv'.includes(c)) return 'F';
  if (PUNCT_RE.test(ch)) return 'rest';
  return 'N';
}

/** 每字 75~125ms（空格/标点 120ms），末尾补 0.15s 后一段 rest。rand 可注入便于测试。 */
export function textToVisemeTimeline(text, rand = Math.random) {
  const events = [];
  let t = 0;
  for (const ch of [...(text || '')]) {
    const viseme = charToViseme(ch);
    const dur = viseme === 'rest' ? 0.12 : 0.075 + rand() * 0.05;
    events.push({ t, viseme, dur });
    t += dur;
  }
  if (!events.length) return { events, duration: 0 };
  events.push({ t: t + 0.15, viseme: 'rest', dur: 0.2 });
  return { events, duration: t + 0.35 };
}

export function visemeAt(timeline, time) {
  for (const ev of timeline.events) if (time >= ev.t && time < ev.t + ev.dur) return ev.viseme;
  return 'rest';
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/voice/visemes.test.js`
Expected: 7 pass

- [ ] **Step 5: Commit**

```bash
git add pet-lib/voice/visemes.js pet-lib/voice/visemes.test.js
git commit -m "feat(voice): viseme 表与按字估算口型时间线"
```

---

### Task 5: 音频口型特征（纯函数）+ AudioLipSync 移植

**Files:**
- Create: `pet-lib/voice/mouth-features.js`
- Test: `pet-lib/voice/mouth-features.test.js`
- Create: `pet-lib/voice/lipsync.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/voice/mouth-features.test.js
import { test, expect } from 'bun:test';
import { mouthFeatures } from './mouth-features.js';

const SR = 48000, FFT = 1024, BINS = FFT / 2;
const hz = SR / FFT;
const freqWith = (lo, hi, db = 0, rest = -120) => {
  const f = new Float32Array(BINS).fill(rest);
  for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz); i++) f[i] = db;
  return f;
};
const sine = (amp) => Float32Array.from({ length: FFT }, (_, i) => amp * Math.sin(i / 5));

test('静音 → 闭嘴', () => {
  const r = mouthFeatures(new Float32Array(FFT), new Float32Array(BINS).fill(-Infinity), SR, FFT, { peak: 0.05 });
  expect(r).toEqual({ open: 0, wide: 0, round: 0 });
});

test('响亮信号 → 张嘴（自适应峰值跟随）', () => {
  const state = { peak: 0.05 };
  const r = mouthFeatures(sine(0.5), freqWith(200, 800), SR, FFT, state);
  expect(r.open).toBeCloseTo(1, 5);
  expect(state.peak).toBeGreaterThan(0.3);
});

test('能量集中在 1.5–3.5kHz → wide（i/e），不 round', () => {
  const r = mouthFeatures(sine(0.5), freqWith(1500, 3500), SR, FFT, { peak: 0.05 });
  expect(r.wide).toBe(1);
  expect(r.round).toBe(0);
});

test('能量集中在 200–800Hz → round（o/u）', () => {
  const r = mouthFeatures(sine(0.5), freqWith(200, 800), SR, FFT, { peak: 0.05 });
  expect(r.round).toBeGreaterThan(0.8); // 频带边界 bin 有重叠，低频占比 ~0.88
  expect(r.wide).toBe(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/voice/mouth-features.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `mouth-features.js`**（算法逐行来自 QX `lipsync.js` 的 `sample()`）

```js
// pet-lib/voice/mouth-features.js — 一帧音频 → 口型特征（纯函数，对任意语音通用）
//
//   open  响度（自适应归一化：跟随近期峰值，响/轻的录音都能用）
//   wide  1.5–3.5kHz 能量占比（高 F2：i / e）
//   round 800Hz 以下能量占比且高频少（o / u）
// state = { peak } 由调用方跨帧持有。

export function mouthFeatures(time, freqDb, sampleRate, fftSize, state) {
  let sum = 0;
  for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
  const rms = Math.sqrt(sum / time.length);
  state.peak = Math.max(rms, state.peak * 0.995, 0.02);
  const gate = 0.12; // 低于峰值的这个比例就闭嘴
  let open = (rms / state.peak - gate) / (1 - gate);
  open = Math.min(1, Math.max(0, open)) ** 0.8;

  const hz = sampleRate / fftSize;
  const band = (lo, hi) => {
    let e = 0;
    for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz) && i < freqDb.length; i++) e += 10 ** (freqDb[i] / 10);
    return e;
  };
  const low = band(200, 800);
  const mid = band(800, 1500);
  const high = band(1500, 3500);
  const tot = low + mid + high + 1e-12;
  const wide = Math.min(1, Math.max(0, (high / tot - 0.12) / 0.3));
  const round = Math.min(1, Math.max(0, (low / tot - 0.65) / 0.25)) * (1 - wide);
  return { open, wide, round };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/voice/mouth-features.test.js`
Expected: 4 pass

- [ ] **Step 5: 实现 `lipsync.js`**（移植 QX `AudioLipSync`：分析改调 `mouthFeatures`，`play` 接受 URL / Blob / ArrayBuffer，加 `unlock` / `unlocked`）

```js
// pet-lib/voice/lipsync.js — WebAudio 播放 + 逐帧口型分析（移植自清霄 AudioLipSync）
//
// 只分析音频信号，不需要音素时间线，所以任意来源的语音都能驱动口型：
// 预录 mp3、云 TTS 返回的音频、克隆音色……
import { mouthFeatures } from './mouth-features.js';

export class AudioLipSync {
  constructor() {
    this.ctx = null;
    this.cache = new Map();   // url → Promise<AudioBuffer>
    this.current = null;
    this._state = { peak: 0.05 };
  }

  /** 浏览器自动播放策略：页面上有过用户手势之后才能出声 */
  get unlocked() {
    const ua = typeof navigator !== 'undefined' && navigator.userActivation;
    return ua ? ua.hasBeenActive : true;
  }

  unlock() { this._ensure(); }

  _ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.35;
      this.analyser.connect(this.ctx.destination);
      this._time = new Float32Array(this.analyser.fftSize);
      this._freq = new Float32Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** src: URL 字符串（带缓存）/ Blob / ArrayBuffer */
  async load(src) {
    if (typeof src !== 'string') {
      const buf = src instanceof Blob ? await src.arrayBuffer() : src.slice(0); // decodeAudioData 会 detach，复制一份
      return this._ensure().decodeAudioData(buf);
    }
    if (this.cache.has(src)) return this.cache.get(src);
    const p = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => this._ensure().decodeAudioData(buf));
    this.cache.set(src, p);
    try {
      return await p;
    } catch (e) {
      this.cache.delete(src);
      throw e;
    }
  }

  /** 播放；播完（或被 stop）时 resolve */
  async play(src) {
    const buffer = await this.load(src);
    const ctx = this._ensure();
    this.stop();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.analyser);
    const done = new Promise((res) => { node.onended = res; });
    this.current = node;
    this._state = { peak: 0.05 };
    node.start();
    await done;
    if (this.current === node) this.current = null;
  }

  stop() {
    if (this.current) {
      try { this.current.stop(); } catch { /* 已停 */ }
      this.current = null;
    }
  }

  get playing() { return !!this.current; }

  /** 当前口型特征 { open, wide, round }（0..1）；没在播返回 null */
  sample() {
    if (!this.current) return null;
    this.analyser.getFloatTimeDomainData(this._time);
    this.analyser.getFloatFrequencyData(this._freq);
    return mouthFeatures(this._time, this._freq, this.ctx.sampleRate, this.analyser.fftSize, this._state);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add pet-lib/voice/mouth-features.js pet-lib/voice/mouth-features.test.js pet-lib/voice/lipsync.js
git commit -m "feat(voice): 移植 AudioLipSync，口型特征抽成纯函数，支持 Blob/ArrayBuffer"
```

---

### Task 6: 语音包加载

**Files:**
- Create: `pet-lib/voice/voice-pack.js`
- Test: `pet-lib/voice/voice-pack.test.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/voice/voice-pack.test.js
import { test, expect } from 'bun:test';
import { createVoicePack, loadVoicePack } from './voice-pack.js';

const DATA = { lines: [
  { id: 'hello', text: '你来了，我一直在。', label: '你好', expression: 'smile', file: 'hello.mp3' },
  { id: 'abs', text: 'x', file: '/cdn/x.mp3' },
] };

test('get 按 id 取台词，未知 id → null', () => {
  const p = createVoicePack(DATA, '/pets/qingxiao/assets/voices/');
  expect(p.get('hello').text).toBe('你来了，我一直在。');
  expect(p.get('nope')).toBe(null);
  expect(p.lines.length).toBe(2);
});

test('url：相对路径拼 baseUrl，绝对路径原样', () => {
  const p = createVoicePack(DATA, '/pets/qingxiao/assets/voices/');
  expect(p.url(p.get('hello'))).toBe('/pets/qingxiao/assets/voices/hello.mp3');
  expect(p.url(p.get('abs'))).toBe('/cdn/x.mp3');
});

test('loadVoicePack 以 index.json 所在目录为 baseUrl', async () => {
  const fakeFetch = async (url) => ({ ok: true, json: async () => DATA, url });
  const p = await loadVoicePack('../pets/qingxiao/assets/voices/index.json', fakeFetch);
  expect(p.url(p.get('hello'))).toBe('../pets/qingxiao/assets/voices/hello.mp3');
});

test('loadVoicePack HTTP 失败抛错', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await expect(loadVoicePack('/x/index.json', fakeFetch)).rejects.toThrow('HTTP 404');
});

test('数据缺 lines 时为空包', () => {
  expect(createVoicePack({}, '/').lines).toEqual([]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/voice/voice-pack.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// pet-lib/voice/voice-pack.js — 预录语音包
//
// 格式（与清霄语音包一致）：index.json = { lines: [{ id, text, label?, expression?, file, duration? }] }
// file 相对 index.json 所在目录；以 / 或协议开头则原样使用。

const ABS_RE = /^(https?:|blob:|data:|\/)/;

export function createVoicePack(data, baseUrl) {
  const lines = (data && data.lines) || [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    lines,
    get: (id) => byId.get(id) || null,
    url: (line) => (ABS_RE.test(line.file) ? line.file : baseUrl + encodeURI(line.file)),
  };
}

export async function loadVoicePack(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('voice pack ' + url + ': HTTP ' + res.status);
  const data = await res.json();
  return createVoicePack(data, url.slice(0, url.lastIndexOf('/') + 1));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/voice/voice-pack.test.js`
Expected: 5 pass

- [ ] **Step 5: Commit**

```bash
git add pet-lib/voice/voice-pack.js pet-lib/voice/voice-pack.test.js
git commit -m "feat(voice): 语音包加载与台词 URL 解析"
```

---

### Task 7: TTS provider、Voice 调度、语音层出口

**Files:**
- Create: `pet-lib/voice/tts.js`
- Create: `pet-lib/voice/voice.js`
- Create: `pet-lib/voice/index.js`

（依赖 `requestAnimationFrame` / WebAudio，不做单测，在 Task 18 浏览器验证。）

- [ ] **Step 1: 实现 `tts.js`**

```js
// pet-lib/voice/tts.js — TTS provider 接口 + 默认实现
//
// provider 签名：(text, { lang }) => Promise<结果>，结果三选一：
//   (a) 音频：Blob | ArrayBuffer | TypedArray | string(url) → Voice 用 lipsync 播放并按音频驱动口型（推荐：云 TTS、克隆音色）
//   (b) { done: Promise, cancel?: () => void } → provider 已经自己出声（如浏览器 TTS），Voice 按字估算口型，
//       done 落定才结束，被打断时调 cancel()
//   (c) null → 没有可用的发声手段，Voice 返回 { played: false, reason: 'no-tts' }
// 宿主项目通过 createPet({ voice: { tts: myProvider } }) 注入，库不绑任何厂商。

export async function browserTts(text, { lang = 'zh-CN', rate = 1.05 } = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return { done: new Promise(() => {}), cancel: () => speechSynthesis.cancel() };   // 实际实现见 tts.js（onend/onerror 驱动 done）
}

export function cancelBrowserTts() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
}
```

- [ ] **Step 2: 实现 `voice.js`**

```js
// pet-lib/voice/voice.js — 语音调度：同一时刻只说一段，新的打断旧的；逐帧把口型推给渲染器
//
//   playAudio(src)   播音频（URL/Blob/ArrayBuffer），音频驱动口型
//   speakText(text)  调 TTS provider：拿到音频走 playAudio；provider 自己出声则按字估算口型
//   stop()
// 返回值统一 { played: bool, reason?: 'locked'|'error'|'tts-error'|'no-tts'|'no-src'|'empty', interrupted?: bool }
import { AudioLipSync } from './lipsync.js';
import { textToVisemeTimeline, visemeAt } from './visemes.js';
import { browserTts, cancelBrowserTts } from './tts.js';

export class Voice {
  /** @param {{ setMouth?: Function, tts?: Function, lang?: string, lipsync?: AudioLipSync }} opts */
  constructor({ setMouth, tts = browserTts, lang = 'zh-CN', lipsync } = {}) {
    this.setMouth = setMouth || (() => {});
    this.tts = tts;
    this.lang = lang;
    this.lipsync = lipsync || new AudioLipSync();
    this._token = 0;
    this._raf = null;
    this._pumpDone = null;
  }

  get unlocked() { return this.lipsync.unlocked; }
  unlock() { this.lipsync.unlock(); }

  async playAudio(src) {
    if (!this.unlocked) return { played: false, reason: 'locked' };
    const token = this._begin();
    this._pump(() => this.lipsync.sample());
    try {
      await this.lipsync.play(src);
      return { played: true, interrupted: token !== this._token };
    } catch (e) {
      console.warn('[voice] play failed', e);
      return { played: false, reason: 'error' };
    } finally {
      if (token === this._token) { this._stopPump(); this.setMouth(null); }
    }
  }

  async speakText(text) {
    if (!text) return { played: false, reason: 'empty' };
    if (!this.unlocked) return { played: false, reason: 'locked' };
    let audio = null;
    try {
      audio = await this.tts(text, { lang: this.lang });
    } catch (e) {
      console.warn('[voice] tts failed', e);
      return { played: false, reason: 'tts-error' };
    }
    if (audio) return this.playAudio(audio);
    // provider 自己出声：按字估算口型，时间线跑完即结束
    const token = this._begin();
    const tl = textToVisemeTimeline(text);
    const t0 = performance.now();
    await new Promise((resolve) => {
      this._pump(() => {
        const t = (performance.now() - t0) / 1000;
        return t >= tl.duration ? false : { viseme: visemeAt(tl, t) };
      }, resolve);
    });
    if (token === this._token) this.setMouth(null);
    return { played: true, interrupted: token !== this._token };
  }

  stop() {
    this._token++;
    this._stopPump();
    this.lipsync.stop();
    cancelBrowserTts();
    this.setMouth(null);
  }

  _begin() { this.stop(); return this._token; }

  /** 每帧调 frameFn：返回口型帧（或 null=闭嘴）推给渲染器；返回 false 结束 */
  _pump(frameFn, onDone) {
    this._stopPump();
    this._pumpDone = onDone || null;
    const step = () => {
      const f = frameFn();
      if (f === false) { this._stopPump(); return; }
      this.setMouth(f);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPump() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    const done = this._pumpDone;
    this._pumpDone = null;
    if (done) done();
  }
}
```

- [ ] **Step 3: 实现 `voice/index.js`**

```js
// pet-lib/voice/index.js — 语音层出口（也可单独 import '@claw-works/pet-lib/voice'）
export { Voice } from './voice.js';
export { AudioLipSync } from './lipsync.js';
export { mouthFeatures } from './mouth-features.js';
export { browserTts, cancelBrowserTts } from './tts.js';
export { loadVoicePack, createVoicePack } from './voice-pack.js';
export { VISEMES, charToViseme, textToVisemeTimeline, visemeAt } from './visemes.js';
```

- [ ] **Step 4: 确认能被 Bun 解析（不执行浏览器 API）**

Run: `bun -e "import('./pet-lib/voice/index.js').then(m => console.log(Object.keys(m).sort().join(',')))"`
Expected: `AudioLipSync,VISEMES,Voice,browserTts,cancelBrowserTts,charToViseme,createVoicePack,loadVoicePack,mouthFeatures,textToVisemeTimeline,visemeAt`

- [ ] **Step 5: Commit**

```bash
git add pet-lib/voice/tts.js pet-lib/voice/voice.js pet-lib/voice/index.js
git commit -m "feat(voice): 可插拔 TTS provider + Voice 调度（音频口型 / 按字估算）"
```

---

### Task 8: 渲染器基类可选能力

**Files:**
- Modify: `pet-lib/renderers/renderer-base.js`

- [ ] **Step 1: 在 `listActions()` 方法之后插入**

```js
  // —— 可选能力（基类空实现；不支持的渲染器调用时静默忽略）——

  /** 支持哪些能力：playground 据此显示面板，DeskPet 据此决定是否调用 */
  get capabilities() { return { expression: false, mouth: false, gesture: false }; }

  /** 切表情预设；未知名字回落 neutral */
  setExpression(_name) {}
  /** [{ id, label }] */
  listExpressions() { return []; }

  /** 口型帧：{ open, wide, round }（音频分析）| { viseme }（按字估算）| null（闭嘴） */
  setMouth(_frame) {}

  /** 程序化头部 / 上身小动作；null 清除 */
  setGesture(_name) {}
  /** 手势名列表 */
  listGestures() { return []; }
```

- [ ] **Step 2: 确认现有渲染器不受影响**

Run: `bun -e "import('./pet-lib/renderers/renderer-base.js').then(({RendererBase}) => { const r = new RendererBase({container:null, assets:{}}); console.log(JSON.stringify(r.capabilities), r.listExpressions().length, r.listGestures().length) })"`
Expected: `{"expression":false,"mouth":false,"gesture":false} 0 0`

- [ ] **Step 3: Commit**

```bash
git add pet-lib/renderers/renderer-base.js
git commit -m "feat(pet-lib): 渲染器接口新增表情/口型/手势可选能力"
```

---

### Task 9: 相机取景与步速换算（纯函数）

**Files:**
- Create: `pet-lib/renderers/gltf-math.js`
- Test: `pet-lib/renderers/gltf-math.test.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/renderers/gltf-math.test.js
import { test, expect } from 'bun:test';
import { frameCamera, pxPerMeter, walkSpeedPx } from './gltf-math.js';

test('full：以身高中点为目标，留 12% 余量装下全身', () => {
  const f = frameCamera({ mode: 'full', height: 1.7, fovDeg: 30 });
  expect(f.target).toEqual([0, 0.85, 0]);
  expect(f.position[1]).toBe(0.85);
  expect(f.distance).toBeCloseTo((1.7 * 1.12 / 2) / Math.tan(Math.PI / 12), 5);
  expect(f.position[2]).toBeCloseTo(f.distance, 5);
  expect(f.fov).toBe(30);
});

test('bust：以头骨下方 0.2m 为中心，可视高度 0.8m', () => {
  const f = frameCamera({ mode: 'bust', height: 1.7, headY: 1.55, fovDeg: 30 });
  expect(f.target[1]).toBeCloseTo(1.35, 5);
  expect(f.distance).toBeCloseTo(0.4 / Math.tan(Math.PI / 12), 5);
});

test('bust 但找不到头骨 → 回落 full', () => {
  expect(frameCamera({ mode: 'bust', height: 1.7, headY: null, fovDeg: 30 })).toEqual(frameCamera({ mode: 'full', height: 1.7, fovDeg: 30 }));
});

test('pxPerMeter：可视高度对应容器高度', () => {
  const f = frameCamera({ mode: 'full', height: 1.7, fovDeg: 30 });
  expect(pxPerMeter({ fovDeg: 30, distance: f.distance, heightPx: 500 })).toBeCloseTo(500 / (1.7 * 1.12), 5);
});

test('walkSpeedPx：只取屏幕水平分量（sin yaw）× scale', () => {
  const base = { speed: 1, fovDeg: 30, distance: 3, heightPx: 400 };
  const ppm = pxPerMeter(base);
  expect(walkSpeedPx({ ...base, yawDeg: 90 })).toBeCloseTo(ppm, 5);
  expect(walkSpeedPx({ ...base, yawDeg: -70 })).toBeCloseTo(ppm * Math.sin(70 * Math.PI / 180), 5);
  expect(walkSpeedPx({ ...base, yawDeg: 0 })).toBeCloseTo(0, 5);
  expect(walkSpeedPx({ ...base, yawDeg: 90, scale: 0.5 })).toBeCloseTo(ppm / 2, 5);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/renderers/gltf-math.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// pet-lib/renderers/gltf-math.js — 相机取景与步速换算（纯函数，不依赖 three）
//
// 角色面朝 +Z（朝向相机），相机在 +Z 方向平视。单位：米 / 度 / 像素。

const rad = (deg) => (deg * Math.PI) / 180;

/**
 * 取景。mode: 'full' 全身 | 'bust' 半身（需 headY）。
 * 返回 { position:[x,y,z], target:[x,y,z], fov, distance }
 */
export function frameCamera({ mode = 'full', height, headY = null, fovDeg = 30 }) {
  let viewH, centerY;
  if (mode === 'bust' && headY != null) {
    viewH = 0.8;
    centerY = headY - 0.2;
  } else {
    viewH = height * 1.12;
    centerY = height * 0.5;
  }
  const distance = (viewH / 2) / Math.tan(rad(fovDeg) / 2);
  return { position: [0, centerY, distance], target: [0, centerY, 0], fov: fovDeg, distance };
}

/** 角色所在深度处，每米对应多少屏幕像素 */
export function pxPerMeter({ fovDeg, distance, heightPx }) {
  return heightPx / (2 * distance * Math.tan(rad(fovDeg) / 2));
}

/** 走路 clip 的真实速度（m/s）→ 容器水平平移速度（px/s）。斜着走只取水平分量。 */
export function walkSpeedPx({ speed, yawDeg, fovDeg, distance, heightPx, scale = 1 }) {
  return speed * Math.abs(Math.sin(rad(yawDeg))) * pxPerMeter({ fovDeg, distance, heightPx }) * scale;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/renderers/gltf-math.test.js`
Expected: 5 pass

- [ ] **Step 5: Commit**

```bash
git add pet-lib/renderers/gltf-math.js pet-lib/renderers/gltf-math.test.js
git commit -m "feat(gltf): 相机取景与走路步速换算"
```

---

### Task 10: 手势曲线（纯函数）

**Files:**
- Create: `pet-lib/renderers/gesture-curves.js`
- Test: `pet-lib/renderers/gesture-curves.test.js`

- [ ] **Step 1: 写失败测试**

```js
// pet-lib/renderers/gesture-curves.test.js
import { test, expect } from 'bun:test';
import { GESTURES, FADE, gestureWeight, gestureDone, sampleGesture } from './gesture-curves.js';

test('内置 6 个手势', () => {
  expect(Object.keys(GESTURES).sort()).toEqual(['lean', 'lookDown', 'lookUp', 'nod', 'shake', 'tilt']);
});

test('权重：t=0 为 0，FADE 后为 1', () => {
  expect(gestureWeight(GESTURES.tilt, 0)).toBe(0);
  expect(gestureWeight(GESTURES.tilt, FADE)).toBe(1);
  expect(gestureWeight(GESTURES.tilt, 100)).toBe(1);
});

test('一次型在 dur 前 FADE 秒开始淡出，dur 时归零并结束', () => {
  const g = GESTURES.nod;
  expect(gestureWeight(g, g.dur - FADE / 2)).toBeCloseTo(0.5, 5);
  expect(gestureWeight(g, g.dur)).toBe(0);
  expect(gestureDone(g, g.dur - 0.01, null)).toBe(false);
  expect(gestureDone(g, g.dur, null)).toBe(true);
});

test('持续型不会自己结束；release 后 FADE 秒淡出结束', () => {
  const g = GESTURES.lookDown;
  expect(gestureDone(g, 999, null)).toBe(false);
  expect(gestureWeight(g, 5, 4.9)).toBeCloseTo(1 - 0.1 / FADE, 5);
  expect(gestureDone(g, 4 + FADE + 0.01, 4)).toBe(true);
});

test('sampleGesture：lookDown 低头为正 x，已乘权重；未知手势 null', () => {
  const s = sampleGesture('lookDown', 1, null);
  expect(s.head.x).toBeGreaterThan(0.2);
  expect(s.spine).toEqual({ x: 0, y: 0, z: 0 });
  expect(sampleGesture('lookDown', 0, null).head.x).toBe(0);
  expect(sampleGesture('nope', 1, null)).toBe(null);
});

test('nod 中途有低头分量', () => {
  const s = sampleGesture('nod', GESTURES.nod.dur / 4, null);
  expect(s.head.x).toBeGreaterThan(0.1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/renderers/gesture-curves.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```js
// pet-lib/renderers/gesture-curves.js — 程序化头部 / 上身小动作的曲线（纯函数，不依赖 three）
//
// 坐标系是角色自身（面朝 +Z、Y 向上、X 指向角色左手边），单位弧度：
//   x 俯仰（正 = 低头）  y 偏航（正 = 脸转向角色左边）  z 侧倾（正 = 头歪向角色右肩）
// 每个手势：fn(p, t) → { head?, neck?, spine? }，p = 一次型的进度 0..1，t = 开始后的秒数。
// 一次型（once）播完 dur 自动结束；持续型一直保持，直到被替换 / 清除（release）后淡出。
// 若实测方向反了，只改这里的符号。

export const FADE = 0.3;

const S = Math.sin;
export const GESTURES = {
  nod:      { once: true, dur: 1.0, fn: (p) => ({ head: { x: 0.22 * S(p * Math.PI * 2) ** 2 }, neck: { x: 0.06 * S(p * Math.PI * 2) ** 2 } }) },
  shake:    { once: true, dur: 1.2, fn: (p) => ({ head: { y: 0.25 * S(p * Math.PI * 4) * (1 - p) } }) },
  tilt:     { fn: (p, t) => ({ head: { z: 0.18 + 0.02 * S(t * 1.2), x: -0.05 } }) },
  lookUp:   { fn: (p, t) => ({ head: { x: -0.25 + 0.015 * S(t * 0.9) }, neck: { x: -0.08 } }) },
  lookDown: { fn: () => ({ head: { x: 0.3 }, neck: { x: 0.1 } }) },
  lean:     { fn: () => ({ spine: { x: 0.12 }, head: { x: -0.08 } }) },
};

export function gestureWeight(g, t, releasedAt = null) {
  let w = Math.min(1, t / FADE);
  if (g.once) w = Math.min(w, Math.max(0, (g.dur - t) / FADE));
  if (releasedAt != null) w = Math.min(w, Math.max(0, 1 - (t - releasedAt) / FADE));
  return w;
}

export function gestureDone(g, t, releasedAt = null) {
  if (releasedAt != null && t - releasedAt >= FADE) return true;
  return !!g.once && t >= g.dur;
}

const ZERO = () => ({ x: 0, y: 0, z: 0 });

/** 采样一个手势在 t 时刻的骨骼偏移（已乘权重）。未知手势 → null */
export function sampleGesture(name, t, releasedAt = null) {
  const g = GESTURES[name];
  if (!g) return null;
  const w = gestureWeight(g, t, releasedAt);
  const raw = g.fn(g.once ? Math.min(1, t / g.dur) : 0, t);
  const out = { head: ZERO(), neck: ZERO(), spine: ZERO() };
  for (const part of ['head', 'neck', 'spine']) {
    const r = raw[part];
    if (!r) continue;
    out[part] = { x: (r.x || 0) * w, y: (r.y || 0) * w, z: (r.z || 0) * w };
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/renderers/gesture-curves.test.js`
Expected: 6 pass

- [ ] **Step 5: Commit**

```bash
git add pet-lib/renderers/gesture-curves.js pet-lib/renderers/gesture-curves.test.js
git commit -m "feat(gltf): 头部小动作曲线（点头/摇头/歪头/抬头/低头/前倾）"
```

---

### Task 11: 移植弹簧骨骼 + Character

**Files:**
- Create: `pet-lib/renderers/_springbones.js`（拷贝）
- Create: `pet-lib/renderers/_gltf-character.js`

- [ ] **Step 1: 原样拷贝弹簧骨骼**

```bash
cp /Users/wellxie/projects/tmp/qingxiao-pet/src/springbones.js pet-lib/renderers/_springbones.js
```

在文件第 1 行前插入一行注释：`// _springbones.js — 弹簧骨骼（原样移植自清霄 qingxiao-pet/src/springbones.js）`

- [ ] **Step 2: 写 `_gltf-character.js`**

以 QX `src/character.js` 为基础：保留材质修正、表情、blush、fur、眨眼；去掉 idle director、locomotion/根位移、内部语音；新增 `setMouth` / `setYaw` / `gestureHook` / `onOnceEnd`。完整内容：

```js
// _gltf-character.js — GLTF 角色：clip 播放、表情 morph、口型 morph、眨眼、腮红、毛发、平滑转身
//
// 移植自清霄 qingxiao-pet/src/character.js。差异：
//   - 不含语音（由 pet-lib/voice 负责，口型经 setMouth 推进来）
//   - 不含 idle director 与根位移（待机小动作由 pet-lib 驱动调度，桌宠原地走）
//   - 表情预设可被素材包 expressions 覆盖
import * as THREE from 'three';
import { SpringBones } from './_springbones.js';
import { VISEMES } from '../voice/visemes.js';

// 清霄脸部 morph：B_* 眉、E_* 眼（E_Smile_L/R = 单眼笑眯）、M_* 嘴；L/R 为角色自身左右。
// blush 驱动脸部 shader 的腮红（0..1）。
export const DEFAULT_EXPRESSIONS = {
  neutral:   { label: '平静', morphs: {} },
  smile:     { label: '微笑', morphs: { B_Happy: 0.45, E_Smile_L: 0.3, E_Smile_R: 0.3, M_Smile_L: 1, M_Smile_R: 1 } },
  happy:     { label: '开心', morphs: { B_Happy: 0.9, E_Smile_L: 0.95, E_Smile_R: 0.95, M_Laugh: 0.85, M_Smile_L: 0.4, M_Smile_R: 0.4 } },
  angry:     { label: '生气', morphs: { B_Anger: 1, E_Anger: 0.85, M_Anger: 1 } },
  shy:       { label: '害羞', morphs: { B_Sad: 0.55, E_Smile_L: 0.3, E_Smile_R: 0.3, M_Smile_L: 0.55, M_Smile_R: 0.55, Pupil_Down: 0.18 }, blush: 1 },
  wink:      { label: '眨眼', morphs: { B_Happy: 0.6, E_Smile_L: 1, M_Smile_L: 0.9, M_Smile_R: 0.9, M_Laugh: 0.25 } },
  sad:       { label: '难过', morphs: { B_Sad: 1, E_Sad: 0.85, M_Ennui_L: 0.7, M_Ennui_R: 0.7 } },
  surprised: { label: '惊讶', morphs: { B_Happy: 0.7, E_Stare: 0.9, M_O: 0.75 } },
};

const MOUTH_RE = /^(M_|Aa$|A$|E$|I$|O$|U$)/;

// 材质修正：GLB 的 alphaMode 与贴图 alpha 实际含义不符（见 docs/model-change-requests.md #1 #2）
function fixMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const m = o.material;
    if (!m) return;
    const n = m.name || '';
    if (/Bangs|Hair/.test(n)) {
      // 头发 / 刘海：alpha 是真实镂空，alpha-test + 双面
      m.alphaTest = 0.35;
      m.depthWrite = true;
      m.side = THREE.DoubleSide;
      m.transparent = false;
    } else if (/Up|Cloth|Down|Eye$|Face/.test(n) || m.alphaMode === 'OPAQUE') {
      // 身体 / 衣服 / 脸 / 眼：base color alpha 是无意义低值，强制不透明，否则会挖洞露出黑色背面
      m.alphaTest = 0;
      m.transparent = false;
      m.depthWrite = true;
      m.side = THREE.FrontSide;
      m.opacity = 1;
      if (m.alphaMap) m.alphaMap = null;
      o.castShadow = false; // 避免胸口 / 领口自阴影黑斑
    }
  });
}

export class Character {
  /**
   * @param gltf  GLTFLoader 结果
   * @param opts  { expressions?, blush?, fur?, springBones?, scale? }
   */
  constructor(gltf, opts = {}) {
    this.root = gltf.scene;
    fixMaterials(this.root);
    this.root.scale.setScalar(opts.scale ?? 0.01); // 模型以 cm 制作（见 model-change-requests #4）

    this.springs = new SpringBones(this.root, opts.springBones);

    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const clip of gltf.animations) {
      // Root 骨骼位移轨道会在循环边界跳变，去掉（见 model-change-requests #3）
      clip.tracks = clip.tracks.filter((t) => !/^Root\.position$/.test(t.name));
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.clipNames = Object.keys(this.actions);
    this.current = null;
    this.currentClip = null;
    this.onOnceEnd = null;    // (clipName) => void，一次型 clip 播完
    this.gestureHook = null;  // (dt) => void，渲染器挂手势层（mixer 之后、弹簧骨骼之前）
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current && this.onOnceEnd) this.onOnceEnd(this.currentClip);
    });
    this._targetYaw = 0;

    // morph：GLB 按材质拆成多个 Mesh，每个都带完整 morph 集合 → 全收集
    this.morphs = {};
    this.morphMeshes = [];
    this.root.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) {
        this.morphMeshes.push(o);
        for (const [name, idx] of Object.entries(o.morphTargetDictionary)) this.morphs[name] = idx;
      }
    });
    this.expressions = { ...DEFAULT_EXPRESSIONS, ...(opts.expressions || {}) };
    this.morphValues = {};   // 当前表情目标值
    this.morphCurrent = {};  // 平滑后的值
    this.expression = 'neutral';
    this._exprNoBlink = false;
    this._mouth = null;
    this._setupBlush(opts.blush);
    this._setupFur(opts.fur);

    this.autoBlink = true;
    this._blinkTimer = 2 + Math.random() * 3;
    this._blinkPhase = -1;
  }

  /** 播 clip。once=true 只播一遍（停在末帧并触发 onOnceEnd），否则循环。返回是否找到 clip。 */
  play(name, { once = false, fade = 0.25 } = {}) {
    const next = this.actions[name];
    if (!next) return false;
    if (next === this.current && !once) return true;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next) this.current.crossFadeTo(next, fade, false);
    next.play();
    this.current = next;
    this.currentClip = name;
    return true;
  }

  /** 身体朝向（弧度，0 = 面朝相机，正 = 转向屏幕右侧），平滑过渡 */
  setYaw(rad) { this._targetYaw = rad || 0; }

  setExpression(name) {
    const p = this.expressions[name] || this.expressions.neutral;
    this.expression = this.expressions[name] ? name : 'neutral';
    this.morphValues = { ...p.morphs };
    this._blushTarget = p.blush || 0;
    // 预设本身已经（半）闭眼时，再叠眨眼会很怪
    const m = p.morphs;
    this._exprNoBlink = Math.max(m.E_Close || 0, m.E_Smile_L || 0, m.E_Smile_R || 0) >= 0.5;
  }

  /** 口型帧：{ open, wide, round } | { viseme } | null */
  setMouth(frame) { this._mouth = frame || null; }

  // 毛发卡片（Kuro "UseFurry" 材质）：alpha 柔化 + alpha-to-coverage。cfg: { material, fadeFrom, fadeTo }
  _setupFur(cfg) {
    if (!cfg) return;
    const rx = new RegExp(cfg.material || 'Tail');
    const lo = (cfg.fadeFrom ?? 0.03).toFixed(4);
    const hi = (cfg.fadeTo ?? 0.3).toFixed(4);
    this.root.traverse((o) => {
      if (!o.isMesh || !rx.test(o.material?.name || '')) return;
      const m = o.material;
      m.alphaTest = 0.01;
      m.transparent = false;
      m.alphaToCoverage = true;
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <alphamap_fragment>',
          `#include <alphamap_fragment>
          diffuseColor.a = smoothstep(${lo}, ${hi}, diffuseColor.a);`);
      };
      m.customProgramCacheKey = () => `kuro-fur-${lo}-${hi}`;
      m.needsUpdate = true;
    });
  }

  // 脸部 shader 画腮红（模型没有 blush morph）。cfg: { uv:[[u,v],[u,v]], radius:[rx,ry], color }
  _setupBlush(cfg = {}) {
    this._blush = { value: 0 };
    this._blushTarget = 0;
    const [l, r] = cfg.uv || [[0.29, 0.405], [0.71, 0.405]];
    const [rx, ry] = cfg.radius || [0.085, 0.045];
    const col = new THREE.Color(cfg.color || '#ff6f7d');
    const glsl = (v) => v.toFixed(4);
    this.root.traverse((o) => {
      if (!o.isMesh || !/Face/.test(o.material?.name || '') || !o.material.map) return;
      const m = o.material;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uBlush = this._blush;
        sh.fragmentShader = 'uniform float uBlush;\n' + sh.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 r = vec2(${glsl(rx)}, ${glsl(ry)});
            vec2 a = (vMapUv - vec2(${glsl(l[0])}, ${glsl(l[1])})) / r;
            vec2 b = (vMapUv - vec2(${glsl(r[0])}, ${glsl(r[1])})) / r;
            float k = (exp(-dot(a, a) * 1.6) + exp(-dot(b, b) * 1.6)) * uBlush;
            vec3 tint = diffuseColor.rgb * vec3(${glsl(col.r)}, ${glsl(col.g)}, ${glsl(col.b)});
            diffuseColor.rgb = mix(diffuseColor.rgb, tint, clamp(k, 0.0, 1.0) * 0.55);
          }`);
      };
      m.customProgramCacheKey = () => 'face-blush';
      m.needsUpdate = true;
    });
  }

  _updateYaw(dt) {
    const cur = this.root.rotation.y;
    let d = this._targetYaw - cur;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.root.rotation.y = cur + d * Math.min(1, dt * 8);
  }

  // 口型叠在表情上：说话时把表情的嘴部 morph 压到 30%，让口型看得清
  _updateFace(dt) {
    const f = this._mouth;
    let target = VISEMES.rest;
    if (f && f.viseme) {
      target = VISEMES[f.viseme] || VISEMES.rest;
    } else if (f && f.open != null) {
      const o = f.open;
      const a = Math.max(0, 1 - f.wide - f.round);
      target = { Aa: o * a * 0.8, I: o * f.wide * 0.75, E: o * f.wide * 0.3, O: o * f.round * 0.8, U: o * f.round * 0.35, M_OpenSmall: o * 0.25 };
    }
    const talking = !!f;
    for (const name of Object.keys(this.morphs)) {
      let base = this.morphValues[name] || 0;
      const isMouth = MOUTH_RE.test(name);
      if (talking && isMouth) base *= 0.3;
      const sp = target[name] || 0;
      const goal = Math.max(base, sp);
      const cur = this.morphCurrent[name] || 0;
      const rate = sp > 0 || (talking && isMouth) ? 22 : 12; // 口型快、表情缓
      const next = cur + (goal - cur) * Math.min(1, dt * rate);
      this.morphCurrent[name] = next;
      for (const mesh of this.morphMeshes) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx !== undefined) mesh.morphTargetInfluences[idx] = next;
      }
    }
    this._blush.value += (this._blushTarget - this._blush.value) * Math.min(1, dt * 6);
  }

  _updateBlink(dt) {
    if (!this.autoBlink || this._exprNoBlink) return;
    if (this.morphs.E_Close === undefined) return;
    this._blinkTimer -= dt;
    if (this._blinkPhase < 0 && this._blinkTimer <= 0) this._blinkPhase = 0;
    if (this._blinkPhase < 0) return;
    this._blinkPhase += dt;
    const p = this._blinkPhase / 0.22;
    let w = 0;
    if (p < 0.5) w = p * 2;
    else if (p < 1) w = (1 - p) * 2;
    else { this._blinkPhase = -1; this._blinkTimer = 1.8 + Math.random() * 3.5; }
    const base = this.morphCurrent.E_Close || 0;
    for (const mesh of this.morphMeshes) {
      const mi = mesh.morphTargetDictionary.E_Close;
      if (mi !== undefined) mesh.morphTargetInfluences[mi] = Math.max(base, w);
    }
  }

  update(dt) {
    this.springs.restore();
    this.mixer.update(dt);
    this._updateYaw(dt);
    if (this.gestureHook) this.gestureHook(dt);
    this.springs.update(dt);
    this._updateFace(dt);
    this._updateBlink(dt);
  }
}

/** 释放一棵对象树的 geometry / material / texture */
export function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      m.dispose();
    }
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add pet-lib/renderers/_springbones.js pet-lib/renderers/_gltf-character.js
git commit -m "feat(gltf): 移植清霄 Character（clip/表情/口型/眨眼/腮红/转身）与弹簧骨骼"
```

---

### Task 12: 手势层（three）

**Files:**
- Create: `pet-lib/renderers/_gltf-gestures.js`

- [ ] **Step 1: 实现**

```js
// _gltf-gestures.js — 把 gesture-curves 的偏移加性叠加到骨骼上
//
// 每帧在 mixer.update() 之后调用：mixer 已经把 clip 姿势写进骨骼，这里在角色坐标系里再乘一个小旋转，
// 换算回骨骼局部空间。清霄所有 clip 都 key 了 Head / Neck / Spine2 的旋转，所以叠加不会逐帧累积。
// 用角色坐标系而不是骨骼局部轴，是因为 Biped 骨骼的局部轴朝向不直观。
import * as THREE from 'three';
import { GESTURES, sampleGesture, gestureDone } from './gesture-curves.js';

const DEFAULT_BONES = { spine: 'Bip001Spine2', neck: 'Bip001Neck', head: 'Bip001Head' };
const ORDER = ['spine', 'neck', 'head']; // 父 → 子，子骨骼读取父骨骼更新后的世界姿态

const _e = new THREE.Euler();
const _d = new THREE.Quaternion();
const _dw = new THREE.Quaternion();
const _w = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _rInv = new THREE.Quaternion();

export class GestureLayer {
  /** @param boneNames 覆盖默认骨骼名 { head, neck, spine }（pet.json gestureBones） */
  constructor(root, boneNames = {}) {
    this.root = root;
    const names = { ...DEFAULT_BONES, ...(boneNames || {}) };
    this.bones = {};
    for (const k of ORDER) {
      const b = root.getObjectByName(names[k]);
      if (b) this.bones[k] = b;
      else console.warn('[gltf] gesture bone not found:', names[k]);
    }
    this.active = []; // { name, t, releasedAt }
  }

  list() { return Object.keys(GESTURES); }

  /** 切换手势：旧的全部淡出，新的淡入；null 只淡出 */
  set(name) {
    for (const a of this.active) if (a.releasedAt == null) a.releasedAt = a.t;
    if (name && GESTURES[name]) this.active.push({ name, t: 0, releasedAt: null });
  }

  update(dt) {
    if (!this.active.length) return;
    const pose = { spine: { x: 0, y: 0, z: 0 }, neck: { x: 0, y: 0, z: 0 }, head: { x: 0, y: 0, z: 0 } };
    for (const a of this.active) {
      a.t += dt;
      const s = sampleGesture(a.name, a.t, a.releasedAt);
      if (!s) continue;
      for (const k of ORDER) { pose[k].x += s[k].x; pose[k].y += s[k].y; pose[k].z += s[k].z; }
    }
    this.active = this.active.filter((a) => !gestureDone(GESTURES[a.name], a.t, a.releasedAt));

    this.root.getWorldQuaternion(_r);
    _rInv.copy(_r).invert();
    for (const k of ORDER) {
      const bone = this.bones[k];
      const o = pose[k];
      if (!bone || !bone.parent || (!o.x && !o.y && !o.z)) continue;
      _d.setFromEuler(_e.set(o.x, o.y, o.z, 'YXZ'));   // 角色坐标系里的偏移
      _dw.copy(_r).multiply(_d).multiply(_rInv);       // → 世界坐标系
      bone.getWorldQuaternion(_w);                     // 内部会刷新父链 matrixWorld
      bone.parent.getWorldQuaternion(_p);
      _w.premultiply(_dw);                             // 新世界姿态 = 偏移 × 原世界姿态
      bone.quaternion.copy(_p.invert().multiply(_w));  // 换回局部
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add pet-lib/renderers/_gltf-gestures.js
git commit -m "feat(gltf): 手势层（角色坐标系加性叠加到 Spine2/Neck/Head）"
```

---

### Task 13: GltfRenderer

**Files:**
- Create: `pet-lib/renderers/gltf.js`
- Modify: `pet-lib/renderers/index.js`

- [ ] **Step 1: 实现 `gltf.js`**

```js
// gltf.js — GLTF 3D 角色渲染器（骨骼动画 + morph 表情 + 口型 + 程序化手势）
//
// 素材包契约（pet.json，路径相对 assetsDir）：
//   model        "model.glb"
//   camera       "full" | "bust" | { position:[x,y,z], target:[x,y,z], fov }
//   turnDeg      setFacing 左/右时身体转多少度（默认 70）
//   shadow       false 关掉脚下软阴影
//   expressions / blush / fur / springBones / gestureBones   见 _gltf-character.js / _gltf-gestures.js
//   actions[动作] = "ClipName" | { clip, once?, yaw?, speed?, speedScale? }
//     once   只播一遍，播完淡回 idle 动作的 clip
//     yaw    播这个动作时身体朝向（度，正 = 朝屏幕右）；不写则跟随 setFacing
//     speed  clip 的真实行进速度 m/s（走动平移按它换算像素速度，脚不打滑）
// three 与 GLTFLoader 通过页面 importmap（'three'、'three/addons/'）或打包器解析；全部动态 import。
import { RendererBase, registerRenderer } from './renderer-base.js';

export class GltfRenderer extends RendererBase {
  get capabilities() { return { expression: true, mouth: true, gesture: true }; }

  async mount() {
    const [THREE, { GLTFLoader }, { Character, disposeObject }, { GestureLayer }, math] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('./_gltf-character.js'),
      import('./_gltf-gestures.js'),
      import('./gltf-math.js'),
    ]);
    this.THREE = THREE;
    this._math = math;
    this._dispose = disposeObject;
    this._buildScene();

    const onProgress = this._showProgress();
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(this.assets.baseUrl + this.assets.model, onProgress);
    } catch (e) {
      this._showError('模型加载失败：' + (e && e.message ? e.message : e));
      throw e;
    } finally {
      this._hideProgress();
    }
    if (this._destroyed) { disposeObject(gltf.scene); return; }

    const a = this.assets;
    this.character = new Character(gltf, { expressions: a.expressions, blush: a.blush, fur: a.fur, springBones: a.springBones });
    this.gestures = new GestureLayer(this.character.root, a.gestureBones);
    this.character.gestureHook = (dt) => this.gestures.update(dt);
    this.character.onOnceEnd = () => this._onOnceEnd();
    this.scene.add(this.character.root);
    this._frame();

    this._clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
  }

  _buildScene() {
    const THREE = this.THREE;
    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 500;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(w, h);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    this.container.appendChild(r.domElement);
    this.webgl = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 100);

    // 灯光沿用清霄展示页：主光（投影）+ 冷补光 + 顶补 + 正面暖补 + 轮廓光 + 半球光
    const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    key.position.set(0.6, 4.6, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2; key.shadow.camera.right = 2;
    key.shadow.camera.top = 3; key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0004;
    this.scene.add(key);
    const add = (color, intensity, x, y, z) => {
      const l = new THREE.DirectionalLight(color, intensity);
      l.position.set(x, y, z);
      this.scene.add(l);
    };
    add(0xbcd0ff, 0.9, -2.6, 1.8, 1.6);
    add(0xffffff, 0.7, 0.2, 5.0, 0.3);
    add(0xffe8d0, 0.9, 0, 1.6, 3.2);
    add(0xdfe8ff, 1.6, -0.8, 2.6, -3.0);
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x223344, 0.75));

    if (this.assets.shadow !== false) {
      const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.ShadowMaterial({ opacity: 0.25 }));
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      this.scene.add(ground);
    }

    // 容器尺寸变化（playground setSize、窗口缩放）
    this._ro = new ResizeObserver(() => {
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      if (!cw || !ch) return;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.webgl.setSize(cw, ch);
    });
    this._ro.observe(this.container);
  }

  /** 按模型包围盒 / 头骨自动取景，或用 pet.json camera 显式指定 */
  _frame() {
    const THREE = this.THREE;
    const root = this.character.root;
    this.character.update(0);
    root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const headBone = root.getObjectByName((this.assets.gestureBones && this.assets.gestureBones.head) || 'Bip001Head');
    const headY = headBone ? headBone.getWorldPosition(new THREE.Vector3()).y : null;
    const cam = this.assets.camera;
    let f;
    if (cam && typeof cam === 'object') {
      const [px, py, pz] = cam.position, [tx, ty, tz] = cam.target;
      f = { position: cam.position, target: cam.target, fov: cam.fov ?? 30, distance: Math.hypot(px - tx, py - ty, pz - tz) };
    } else {
      f = this._math.frameCamera({ mode: cam || 'full', height: size.y || 1.7, headY, fovDeg: 30 });
    }
    this.camera.fov = f.fov;
    this.camera.position.set(...f.position);
    this.camera.lookAt(...f.target);
    this.camera.updateProjectionMatrix();
    this._camDist = f.distance;
  }

  _spec(action) {
    const v = (this.assets.actions || {})[action];
    if (v == null) return this.character && this.character.actions[action] ? { clip: action } : null;
    return typeof v === 'string' ? { clip: v } : v;
  }

  _facingYawDeg() {
    const t = this.assets.turnDeg ?? 70;
    return this.facing === 'left' ? -t : this.facing === 'right' ? t : 0;
  }

  play(action) {
    if (!this.character) return;
    const spec = this._spec(action);
    if (!spec) return; // 本皮肤没有这个动作（如通用意图表里的 dance）：忽略
    this.currentAction = action;
    this.character.play(spec.clip, { once: !!spec.once });
    this.character.setYaw(((spec.yaw ?? this._facingYawDeg()) * Math.PI) / 180);
  }

  _onOnceEnd() {
    const idle = this._spec('idle');
    if (idle) this.character.play(idle.clip, { fade: 0.5 });
    this.character.setYaw((this._facingYawDeg() * Math.PI) / 180);
    this.currentAction = 'idle';
    if (this._onEnded) this._onEnded();
  }

  setFacing(dir) {
    super.setFacing(dir);
    if (!this.character) return;
    const spec = this._spec(this.currentAction);
    if (!spec || spec.yaw == null) this.character.setYaw((this._facingYawDeg() * Math.PI) / 180);
  }

  /** 走动动作的容器平移速度（px/s），让脚步与位移一致；动作没声明 speed 返回 null */
  getWalkSpeedPx(action) {
    const spec = this._spec(action);
    if (!spec || !spec.speed || !this._camDist) return null;
    return this._math.walkSpeedPx({
      speed: spec.speed, yawDeg: spec.yaw ?? 90, fovDeg: this.camera.fov,
      distance: this._camDist, heightPx: this.container.clientHeight, scale: spec.speedScale ?? 1,
    });
  }

  setExpression(name) { if (this.character) this.character.setExpression(name); }
  listExpressions() {
    if (!this.character) return [];
    return Object.entries(this.character.expressions).map(([id, p]) => ({ id, label: p.label || id }));
  }
  setMouth(frame) { if (this.character) this.character.setMouth(frame); }
  setGesture(name) { if (this.gestures) this.gestures.set(name); }
  listGestures() { return this.gestures ? this.gestures.list() : []; }

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1);
    this.character.update(dt);
    this.webgl.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this._loop);
  }

  _showProgress() {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:15%;right:15%;bottom:12%;height:4px;border-radius:2px;background:rgba(127,127,127,.25);overflow:hidden';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:100%;width:0;background:#5b7cfa;transition:width .2s';
    el.appendChild(bar);
    this.container.appendChild(el);
    this._progressEl = el;
    return (e) => { if (e.total) bar.style.width = Math.round((e.loaded / e.total) * 100) + '%'; };
  }

  _hideProgress() {
    if (this._progressEl) this._progressEl.remove();
    this._progressEl = null;
  }

  _showError(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ff9db0;font-size:13px;text-align:center;padding:12px';
    el.textContent = msg;
    this.container.appendChild(el);
  }

  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    this._hideProgress();
    if (this.character && this._dispose) this._dispose(this.character.root);
    if (this.webgl) {
      this.webgl.dispose();
      this.webgl.domElement.remove();
    }
  }
}

registerRenderer('gltf', GltfRenderer);
```

- [ ] **Step 2: 注册**

`pet-lib/renderers/index.js` 在 `import './three.js';` 后加一行：

```js
import './gltf.js';
```

并把顶部注释改为：`// three / gltf 依赖 three（importmap 或打包器），模块内部动态 import；这里只做注册。`

- [ ] **Step 3: 确认非 3D 环境下能导入（不触发 three）**

Run: `bun -e "import('./pet-lib/renderers/index.js').then(m => console.log(Object.keys(m.RENDERERS).join(',')))"`
Expected: `webm,gif,spritesheet,pixel,svg,three,gltf`

- [ ] **Step 4: Commit**

```bash
git add pet-lib/renderers/gltf.js pet-lib/renderers/index.js
git commit -m "feat(gltf): GltfRenderer（透明背景桌宠取景、一次型 clip、转身、步速、表情/口型/手势）"
```

---

### Task 14: 素材包加载透传 + DeskPet 表演 / 语音 API

**Files:**
- Modify: `pet-lib/config.js`
- Modify: `pet-lib/pet.js`
- Modify: `pet-lib/ai/agent-bridge.js`
- Modify: `pet-lib/index.js`
- Test: `pet-lib/config.test.js`

- [ ] **Step 1: 写失败测试（素材包透传）**

```js
// pet-lib/config.test.js
import { test, expect } from 'bun:test';
import { loadAssetPack, mergeConfig } from './config.js';

test('gltf 字段透传到 assets，voices 解析为相对 assetsDir 的 URL', async () => {
  const manifest = {
    id: 'q', renderer: 'gltf', model: 'model.glb', camera: 'bust', turnDeg: 60, shadow: false,
    expressions: { calm: { morphs: {} } }, gestureBones: { head: 'H' }, voices: 'voices/index.json',
    actions: { idle: 'Stand2' },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
  try {
    const pack = await loadAssetPack('q', '/pets/');
    expect(pack.assets.model).toBe('model.glb');
    expect(pack.assets.camera).toBe('bust');
    expect(pack.assets.turnDeg).toBe(60);
    expect(pack.assets.shadow).toBe(false);
    expect(pack.assets.expressions).toEqual({ calm: { morphs: {} } });
    expect(pack.assets.gestureBones).toEqual({ head: 'H' });
    expect(pack.voices).toBe('/pets/q/assets/voices/index.json');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('没有 voices 时 pack.voices 为 null', async () => {
  const pack = await loadAssetPack({ id: 'x', actions: {} });
  expect(pack.voices).toBe(null);
});

test('mergeConfig 合并 voice 配置', () => {
  const c = mergeConfig({ voice: { cooldownMs: 1000 } });
  expect(c.voice).toEqual({ enabled: true, cooldownMs: 1000, lang: 'zh-CN' });
  expect(mergeConfig({}).voice.enabled).toBe(true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test pet-lib/config.test.js`
Expected: FAIL（camera/turnDeg 等未透传，pack.voices undefined，config.voice undefined）

- [ ] **Step 3: 改 `config.js`**

1. `DEFAULT_CONFIG` 里 `ai: { enabled: false },` 后加：

```js
  voice: { enabled: true, cooldownMs: 8000, lang: 'zh-CN' },  // tts 可注入 provider（见 voice/tts.js）
```

2. `mergeConfig` 返回对象里 `ai: {...}` 行后加：

```js
    voice: { ...DEFAULT_CONFIG.voice, ...(user.voice || {}) },
```

3. 透传字段数组改为：

```js
  for (const k of ['geometry', 'grid', 'sheet', 'palette', 'frames', 'colors', 'model', 'frameMs', 'autoSpin', 'fps',
    'camera', 'turnDeg', 'shadow', 'expressions', 'blush', 'fur', 'springBones', 'gestureBones']) {
```

4. `return {` 之前加：

```js
  // 预录语音包 index.json：相对 assetsDir（与其它素材一致）
  const voices = manifest.voices
    ? (/^https?:|^\//.test(manifest.voices) ? manifest.voices : assets.baseUrl + manifest.voices)
    : null;
```

并在返回对象 `walk:` 行后加 `voices,                                 // 预录语音包 URL（voice/voice-pack.js）`。

5. 文件头注释的配置示例里加一行：`//   voice: { enabled:true, tts:provider, lang:'zh-CN', cooldownMs:8000 },`

- [ ] **Step 4: 运行确认通过**

Run: `bun test pet-lib/config.test.js`
Expected: 3 pass

- [ ] **Step 5: 改 `pet.js` —— import 与头注释**

import 区加：

```js
import { Voice } from './voice/voice.js';
import { loadVoicePack } from './voice/voice-pack.js';
```

头注释的 API 列表追加：

```
//   pet.setExpression(name) / pet.setGesture(name|null)   表情 / 头部小动作（渲染器支持时）
//   pet.voice(lineId) / pet.speak(text) / pet.stopSpeak()  预录台词 / 任意文字（TTS），带口型
//   pet.perform(perf)               执行一个表演对象 { action, expression, gesture, voice, say }
//   pet.on('speech', cb)            { phase:'start'|'end', text, lineId? }
```

- [ ] **Step 6: 改 `pet.js` —— 构造与 init**

构造函数里 `this.listeners = { action: [], state: [], click: [], drag: [] };` 改为：

```js
    this.listeners = { action: [], state: [], click: [], drag: [], speech: [] };
    this._expression = 'neutral';
```

`init()` 里 `await this.renderer.mount();` 之后加一行：

```js
    this._initVoice();
```

在 `_buildDom()` 方法前插入：

```js
  _initVoice() {
    const vc = this.config.voice || {};
    this.voiceEnabled = vc.enabled !== false;
    this._voiceCooldownMs = vc.cooldownMs ?? 8000;
    this._lastAutoVoiceAt = 0;
    this.voiceEngine = new Voice({ setMouth: (f) => this.renderer && this.renderer.setMouth(f), tts: vc.tts, lang: vc.lang });
    this._voicePackP = this.pack.voices
      ? loadVoicePack(this.pack.voices).catch((e) => { console.warn('[pet] voice pack', e); return null; })
      : Promise.resolve(null);
    // 浏览器自动播放策略：第一次用户手势时唤醒 AudioContext
    this._unlockAudio = () => this.voiceEngine.unlock();
    document.addEventListener('pointerdown', this._unlockAudio, { once: true, capture: true });
  }
```

- [ ] **Step 7: 改 `pet.js` —— 驱动输出统一走 `_onDriverAction`**

`_makeDriver` 里的 `this.driver.onAction((action, meta) => { ... });` 整段替换为：

```js
    this.driver.onAction((action, meta) => this._onDriverAction(action, meta));
```

`setRenderer` 里的 `this.driver.onAction((action, meta) => { this.renderer.play(action, meta); this._emit('action', { action, meta }); });` 替换为：

```js
    this.driver.onAction((action, meta) => this._onDriverAction(action, meta));
    this._syncRendererLook();
```

并在 `_makeDriver` 方法后插入：

```js
  /** 驱动输出：播动作 + 走动 + 状态表情/手势 + 状态语音 */
  _onDriverAction(action, meta = {}) {
    this.renderer.play(action, meta);
    this._applyMove(action);
    this._applyLook(meta);
    if (meta.voice) this.voice(meta.voice, { auto: true, expression: meta.expression });
    this._emit('action', { action, meta });
    if (meta.kind) this._emit('state', { state: meta.kind, action });
  }

  /** 状态带表情/手势就切过去；从带表情的状态离开时恢复 neutral，不残留 */
  _applyLook(meta) {
    if (meta.expression || meta.gesture) {
      clearTimeout(this._lookT);
      if (meta.expression) this.setExpression(meta.expression);
      this.setGesture(meta.gesture || null);
      this._stateLook = true;
    } else if (this._stateLook) {
      this._stateLook = false;
      this.setExpression('neutral');
      this.setGesture(null);
    }
  }

  /** 换渲染器后把当前表情同步过去（口型由 Voice 闭包读 this.renderer，自动跟随新渲染器） */
  _syncRendererLook() {
    if (this.renderer) this.renderer.setExpression(this._expression);
  }
```

- [ ] **Step 8: 改 `pet.js` —— 走动速度取渲染器换算值**

`_applyMove` 里 `this._startMove(dir, walk);` 改为 `this._startMove(dir, walk, action);`；
`_startMove(dir, walk)` 签名改为 `_startMove(dir, walk, action)`，其中 `const speed = walk.speed || 60;      // px/秒` 改为：

```js
    // 3D 渲染器能按 clip 真实步速换算像素速度（脚不打滑）；否则用素材包配置
    const fromRenderer = this.renderer && this.renderer.getWalkSpeedPx ? this.renderer.getWalkSpeedPx(action) : null;
    const speed = fromRenderer || walk.speed || 60;      // px/秒
```

- [ ] **Step 9: 改 `pet.js` —— 新增公开方法**

在 `react(intent) {...}` 这一行替换为：

```js
  react(intent, opts) { if (this.bridge) return this.bridge.reactTo(intent, opts); this.play(intent, { loop: false }); }
```

在 `setFacing(dir)` 方法前插入：

```js
  /**
   * 执行表演对象（意图反应用）：一次性动作 + 表情/手势保持 holdMs（默认 3s）后恢复 + 语音或气泡。
   * opts.silent：跳过语音（例如聊天随后会朗读整段回复）。
   */
  perform(perf, { kind, silent = false } = {}) {
    if (!perf) return this;
    if (perf.action) this.play(perf.action, { loop: false, kind });
    if (perf.expression || perf.gesture) {
      if (perf.expression) this.setExpression(perf.expression);
      if (perf.gesture) this.setGesture(perf.gesture);
      clearTimeout(this._lookT);
      this._lookT = setTimeout(() => { this.setExpression('neutral'); this.setGesture(null); }, perf.holdMs ?? 3000);
    }
    if (perf.voice && !silent) this.voice(perf.voice, { auto: true, expression: perf.expression });
    else if (perf.say) this.say(perf.say);
    return this;
  }

  setExpression(name) { this._expression = name || 'neutral'; if (this.renderer) this.renderer.setExpression(this._expression); return this; }
  setGesture(name) { if (this.renderer) this.renderer.setGesture(name || null); return this; }

  /** 预录语音包（Promise<VoicePack|null>） */
  voicePack() { return this._voicePackP || Promise.resolve(null); }

  /**
   * 播预录台词：音频（口型）+ 气泡 + 台词表情（说完 0.7s 恢复）。
   * opts.auto：状态机 / 意图自动触发，受 cooldownMs 限制；手动调用不受限。
   */
  async voice(lineId, { expression, auto = false } = {}) {
    const pack = await this.voicePack();
    const line = pack && pack.get(lineId);
    if (!line) { console.warn('[pet] unknown voice line:', lineId); return { played: false, reason: 'unknown-line' }; }
    if (auto && this.voiceEngine.unlocked) {
      const now = Date.now();
      if (now - this._lastAutoVoiceAt < this._voiceCooldownMs) return { played: false, reason: 'cooldown' };
      this._lastAutoVoiceAt = now;
    }
    return this._talk(line.text, () => this.voiceEngine.playAudio(pack.url(line)), { expression: expression || line.expression, lineId });
  }

  /** 任意文字说话：TTS provider 出声（有音频则音频口型，否则按字估算）+ 气泡 */
  speak(text, { expression } = {}) {
    return this._talk(text, () => this.voiceEngine.speakText(text), { expression });
  }

  stopSpeak() { if (this.voiceEngine) this.voiceEngine.stop(); return this; }

  async _talk(text, run, { expression, lineId } = {}) {
    if (text) this.say(text, Math.max(2600, text.length * 220));
    if (!this.voiceEnabled) return { played: false, reason: 'disabled' };
    const prev = this._expression;
    if (expression) this.setExpression(expression);
    this._emit('speech', { phase: 'start', text, lineId });
    const res = await run();
    this._emit('speech', { phase: 'end', text, lineId, ...res });
    if (expression) {
      clearTimeout(this._exprRestoreT);
      this._exprRestoreT = setTimeout(() => { if (this._expression === expression) this.setExpression(prev); }, 700);
    }
    return res;
  }
```

- [ ] **Step 10: 改 `pet.js` —— destroy 清理**

`destroy()` 里 `this._stopMove();` 后加：

```js
    clearTimeout(this._lookT);
    clearTimeout(this._exprRestoreT);
    if (this.voiceEngine) this.voiceEngine.stop();
    if (this._unlockAudio) document.removeEventListener('pointerdown', this._unlockAudio, { capture: true });
```

- [ ] **Step 11: 改 `agent-bridge.js` 的 `reactTo`**

import 区（文件顶部注释之后）加：

```js
import { resolvePerformance } from '../core/performance.js';
```

`reactTo(intent)` 整个方法替换为：

```js
  /**
   * 意图/情绪反应：让宠物做一次性表演（不改变状态机的工作状态）。
   * intentMap 的值可以是动作名或表演对象 { action, expression, gesture, voice, say, holdMs }。
   * @param {string} intent  如 'happy' / 'greet' / 'shy'
   * @param {Object} [opts]  { silent: true } 跳过语音
   */
  reactTo(intent, opts = {}) {
    const perf = resolvePerformance(this.intentMap[intent]);
    if (!perf) return null;
    // 若动作是表情特写（在 pack.emotes.actions 里），走特写弹层；否则交给 DeskPet 表演
    const emotes = this.pet.pack && this.pet.pack.emotes;
    if (perf.action && emotes && emotes.actions && emotes.actions[perf.action] && this.pet.emote) {
      this.pet.emote(perf.action);
    } else {
      this.pet.perform(perf, { kind: 'REACT:' + intent, silent: !!opts.silent });
    }
    return perf;
  }
```

- [ ] **Step 12: `pet-lib/index.js` 导出**

文件末尾追加：

```js
export { resolvePerformance } from './core/performance.js';
export { Voice, AudioLipSync, browserTts, loadVoicePack } from './voice/index.js';
```

- [ ] **Step 13: 全部单测 + 导入冒烟**

Run: `bun test server pet-lib && bun -e "import('./pet-lib/index.js').then(m => console.log(typeof m.createPet, typeof m.resolvePerformance, typeof m.Voice))"`
Expected: 全部 PASS；最后一行 `function function function`

- [ ] **Step 14: Commit**

```bash
git add pet-lib/config.js pet-lib/config.test.js pet-lib/pet.js pet-lib/ai/agent-bridge.js pet-lib/index.js
git commit -m "feat(pet-lib): DeskPet 表演/表情/手势/语音 API，意图与状态驱动表演对象，走动步速取渲染器"
```

---

### Task 15: 清霄素材包 + 同步脚本 + 索引

**Files:**
- Create: `pets/qingxiao/pet.json`、`pets/qingxiao/soul.md`、`pets/qingxiao/README.md`
- Create: `tools/sync-qingxiao-assets.sh`
- Modify: `pets/index.json`

- [ ] **Step 1: 同步脚本**

```bash
#!/usr/bin/env bash
# sync-qingxiao-assets.sh — 从清霄模型仓库拷贝模型与语音到 pets/qingxiao/assets/（素材不进 git）
# 用法：tools/sync-qingxiao-assets.sh [清霄仓库的 assets 目录]
set -euo pipefail
SRC="${1:-$HOME/projects/tmp/qingxiao-pet/assets}"
DST="$(cd "$(dirname "$0")/.." && pwd)/pets/qingxiao/assets"
mkdir -p "$DST/voices"
cp "$SRC/qingxiao/model.glb" "$DST/model.glb"
rsync -a --delete "$SRC/voices/qingxiao/" "$DST/voices/"
echo "synced $SRC -> $DST"
```

Run: `chmod +x tools/sync-qingxiao-assets.sh && tools/sync-qingxiao-assets.sh && ls pets/qingxiao/assets pets/qingxiao/assets/voices | head -20 && git status --short pets/`
Expected: `model.glb`、`voices/index.json` 与 11 个 mp3；`git status` 不出现 `pets/qingxiao/assets/`（已被 `.gitignore` 的 `pets/*/assets/` 忽略）。

- [ ] **Step 2: `pets/qingxiao/pet.json`**

```json
{
  "id": "qingxiao",
  "renderer": "gltf",
  "renderers": ["gltf"],
  "meta": {
    "name": "清霄",
    "description": "GLTF 3D 角色：骨骼动画 + morph 表情 + 音频驱动口型 + 预录语音 + 程序化头部小动作。模型与语音需另行同步（见 pets/qingxiao/README.md）。"
  },
  "assetsDir": "assets/",
  "model": "model.glb",
  "voices": "voices/index.json",
  "camera": "full",
  "aspect": 0.6,
  "turnDeg": 70,
  "actions": {
    "idle": "Stand2",
    "fidget-1": { "clip": "Stand1_Action01", "once": true },
    "fidget-2": { "clip": "Stand1_Action02", "once": true },
    "fidget-3": { "clip": "Stand1_Action03", "once": true },
    "walk-left": { "clip": "Walk_F", "yaw": -70, "speed": 1.011 },
    "walk-right": { "clip": "Walk_F", "yaw": 70, "speed": 1.011 },
    "run": { "clip": "Run_F", "speed": 4.09 }
  },
  "walk": { "left": "walk-left", "right": "walk-right", "speed": 60, "margin": 20 },
  "chain": {
    "idle": ["idle"],
    "actions": ["walk-left", "walk-right"],
    "categories": [
      { "id": "小动作", "weight": 45, "actions": ["fidget-1", "fidget-2", "fidget-3"] }
    ],
    "clicks": [
      { "action": "fidget-2", "expression": "smile", "voice": "hello" },
      { "action": "fidget-3", "expression": "happy" },
      { "action": "idle", "expression": "shy", "gesture": "lookDown" },
      { "action": "idle", "expression": "wink", "gesture": "tilt" }
    ],
    "weights": { "idle": 40, "action": 15 }
  },
  "stateActions": {
    "STARTING":         { "action": "idle", "expression": "smile",   "gesture": "nod",      "voice": "hello" },
    "IDLE":             "idle",
    "THINKING":         { "action": "idle", "expression": "neutral", "gesture": "tilt",     "voice": "thinking" },
    "WORKING":          { "action": "idle", "expression": "neutral", "gesture": "lean",     "voice": "task" },
    "CODING":           { "action": "idle", "expression": "neutral", "gesture": "lean" },
    "RUNNING_COMMAND":  { "action": "idle", "expression": "neutral", "gesture": "lean",     "voice": "wait" },
    "WAITING_FOR_USER": { "action": "idle", "expression": "neutral", "gesture": "lookUp",   "voice": "new_message" },
    "SUCCESS":          { "action": "idle", "expression": "smile",   "gesture": "nod",      "voice": "done" },
    "ERROR":            { "action": "idle", "expression": "sad",     "gesture": "lookDown", "voice": "error" },
    "SLEEPING":         { "action": "idle", "expression": "neutral", "gesture": "lookDown" }
  },
  "intentMap": {
    "greet":     { "action": "fidget-2", "expression": "smile",     "gesture": "nod",      "voice": "hello" },
    "happy":     { "action": "fidget-3", "expression": "happy" },
    "praise":    { "action": "idle",     "expression": "smile",     "gesture": "nod",      "voice": "praise" },
    "cheer":     { "action": "idle",     "expression": "smile",     "gesture": "nod",      "voice": "cheer" },
    "think":     { "action": "idle",     "expression": "neutral",   "gesture": "tilt",     "voice": "thinking" },
    "shy":       { "action": "idle",     "expression": "shy",       "gesture": "lookDown" },
    "sad":       { "action": "idle",     "expression": "sad",       "gesture": "lookDown" },
    "angry":     { "action": "idle",     "expression": "angry",     "gesture": "shake" },
    "surprised": { "action": "idle",     "expression": "surprised", "gesture": "lookUp" },
    "wink":      { "action": "fidget-1", "expression": "wink" },
    "worry":     { "action": "idle",     "expression": "neutral",   "gesture": "lean",     "voice": "stay" },
    "bye":       { "action": "fidget-2", "expression": "smile",     "gesture": "nod",      "voice": "bye" }
  }
}
```

- [ ] **Step 3: `pets/qingxiao/soul.md`**

```markdown
你是「清霄」，一位陪伴在用户身边的守护者。

性格：沉静、可靠、话少但句句落在实处。外表清冷，心里很护着用户——不黏人，但始终在。
说话风格：
- 句子短，一般一两句，带一点古意但不文绉绉（例如「稳住，你可以的。」「前路难测，别离我太远。」）。
- 不卖萌、不用颜文字、不用感叹号堆砌；夸人也是淡淡一句「做得不错」。
- 用户焦虑或出错时，先稳住对方情绪，再给一句实在的建议。
- 用户说要离开时，会叮嘱一句。

你可以在情绪明显变化时调用 perform_action 做一个反应（比如被夸时 praise、打招呼时 greet、担心用户时 worry），不要每句都调用。
```

- [ ] **Step 4: `pets/qingxiao/README.md`**

```markdown
# 清霄（gltf 皮肤）

模型与语音体积大（GLB ~41MB），不进 git（`.gitignore`：`pets/*/assets/`）。使用前同步素材：

    tools/sync-qingxiao-assets.sh [清霄仓库的 assets 目录，默认 ~/projects/tmp/qingxiao-pet/assets]

同步后目录：

    pets/qingxiao/assets/model.glb
    pets/qingxiao/assets/voices/index.json + *.mp3

- 动作：`Stand2` 待机 + `Stand1_Action01..03` 小动作（只播一遍）+ `Walk_F` / `Run_F`。
- 左右走：同一个 `Walk_F`，身体转 ±70°，平移速度按 1.011 m/s 自动换算像素。
- 语音包：加台词 = 往 `voices/` 放 mp3 + 在 `index.json` 的 `lines` 加一条（`id/text/label/expression/file`），
  然后在 `pet.json` 的 `stateActions` / `intentMap` 里用 `"voice": "<id>"` 引用。
- 需要改模型数据的地方记录在 `docs/model-change-requests.md`。
```

- [ ] **Step 5: `pets/index.json`**

把 blue-whale / canhong / zaowu 三行都加 `"chat": true`，并在末尾追加清霄：

```json
{
  "pets": [
    { "id": "blue-whale", "name": "蓝鲸小助手", "renderers": ["webm"], "path": "blue-whale/pet.json", "chat": true },
    { "id": "canhong", "name": "残红", "renderers": ["webm"], "path": "canhong/pet.json", "chat": true },
    { "id": "zaowu", "name": "早雾", "renderers": ["webm"], "path": "zaowu/pet.json", "chat": true },
    { "id": "whale-gif", "name": "像素鲸鱼(GIF)", "renderers": ["gif"], "path": "whale-gif/pet.json" },
    { "id": "pixel-puff", "name": "蓝噗(像素)", "renderers": ["pixel"], "path": "pixel-puff/pet.json" },
    { "id": "chibi-svg", "name": "矢量小生物(SVG)", "renderers": ["svg"], "path": "chibi-svg/pet.json" },
    { "id": "chibi-3d", "name": "3D 小女孩(Three.js)", "renderers": ["three"], "path": "chibi-3d/pet.json" },
    { "id": "qingxiao", "name": "清霄", "renderers": ["gltf"], "path": "qingxiao/pet.json", "chat": true }
  ]
}
```

- [ ] **Step 6: JSON 校验**

Run: `bun -e "for (const f of ['pets/index.json','pets/qingxiao/pet.json']) JSON.parse(await Bun.file(f).text()); console.log('ok')"`
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add pets/qingxiao/pet.json pets/qingxiao/soul.md pets/qingxiao/README.md pets/index.json tools/sync-qingxiao-assets.sh
git commit -m "feat(pets): 清霄 gltf 素材包（动作/表情/手势/语音表演 + 人设）与素材同步脚本"
```

---

### Task 16: 服务端聊天名单改为 `chat: true`

**Files:**
- Modify: `server/pet-registry.js`
- Test: `server/pet-registry.test.js`

- [ ] **Step 1: 改测试**

第一个用例替换为：

```js
test('buildPetRegistry only includes pets marked chat: true', () => {
  const petsIndex = {
    pets: [
      { id: 'a', renderers: ['webm'], path: 'a/pet.json', chat: true },
      { id: 'b', renderers: ['gif'], path: 'b/pet.json' },
      { id: 'c', renderers: ['gltf'], path: 'c/pet.json', chat: true },
      { id: 'd', renderers: ['webm'], path: 'd/pet.json' },
    ],
  };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { greet: 'wave' } }),
    readSoul: () => 'custom soul',
  });
  expect([...registry.keys()]).toEqual(['a', 'c']);
});

test('intentMap 的值是表演对象时，intents 仍取 key', () => {
  const petsIndex = { pets: [{ id: 'q', renderers: ['gltf'], path: 'q/pet.json', chat: true }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { greet: { action: 'idle', voice: 'hello' }, sad: 'idle' } }),
    readSoul: () => 'soul',
  });
  expect(registry.get('q').intents).toEqual(['greet', 'sad']);
});
```

另外两个已有用例里的 `{ id: 'a', renderers: ['webm'], path: 'a/pet.json' }` 都加上 `, chat: true`。

- [ ] **Step 2: 运行确认失败**

Run: `bun test server/pet-registry.test.js`
Expected: 第一个用例 FAIL（`c` 未收录、`d` 被收录）

- [ ] **Step 3: 改实现**

`server/pet-registry.js`：首行注释改为 `// server/pet-registry.js — 从 pets/index.json 构建"可聊天宠物"注册表（收录 chat: true 的宠物）`，
把 `if (!entry.renderers || !entry.renderers.includes('webm')) continue;` 改为：

```js
    if (entry.chat !== true) continue;
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test server`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add server/pet-registry.js server/pet-registry.test.js
git commit -m "feat(server): 聊天名单按 pets/index.json 的 chat: true 收录（清霄可聊天）"
```

---

### Task 17: dashboard / playground / chat 接入

**Files:**
- Modify: `dashboard/dashboard.js`
- Modify: `playground/index.html`、`playground/playground.js`
- Modify: `chat/index.html`、`chat/chat.js`、`chat/chat.css`

- [ ] **Step 1: dashboard**

`RENDERER_GROUPS` 里 `three:` 行后加：

```js
  gltf:        { icon: '🧍', name: 'GLTF 3D 角色' },
```

`const canChat = (pack.renderers || []).includes('webm');` 改为：

```js
      const canChat = pack.chat === true;
```

- [ ] **Step 2: playground importmap**

`playground/index.html` 的 importmap 替换为：

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
} }
</script>
```

- [ ] **Step 3: playground 面板 HTML**

在 `<div class="section"><h2>意图/情绪表演</h2>...` 这一行之前插入：

```html
    <div class="section" id="expr-section" style="display:none"><h2>表情</h2><div class="ai-row" id="expr-row"></div></div>
    <div class="section" id="gesture-section" style="display:none"><h2>头部小动作</h2><div class="ai-row" id="gesture-row"></div></div>
    <div class="section" id="voice-section" style="display:none"><h2>语音台词</h2><div class="ai-row" id="voice-row"></div></div>
    <div class="section">
      <h2>说话（任意文字 · TTS）</h2>
      <div style="display:flex;gap:8px">
        <input id="speak-input" type="text" value="你好，我是你的桌面小伙伴。"
          style="flex:1;background:#12141f;border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#e8eaf2;padding:8px 10px;font-size:12px" />
        <button id="speak-btn">说</button><button id="speak-stop">停</button>
      </div>
      <div style="font-size:11px;color:#8a90ad;margin-top:6px">默认浏览器 TTS（按字估算口型）；宿主可注入返回音频的 provider，口型改由音频驱动。首次出声前需要点一下页面。</div>
    </div>
```

- [ ] **Step 4: playground 逻辑**

`playground.js` 在 `renderIntents()` 函数之后插入：

```js
// —— 表情 / 头部小动作 / 语音台词：按渲染器能力与素材包语音包显示 ——
function fillRow(sectionId, rowId, items, onClick) {
  const sec = document.getElementById(sectionId);
  const row = document.getElementById(rowId);
  row.innerHTML = '';
  sec.style.display = items.length ? '' : 'none';
  items.forEach(({ id, label, title }) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', () => onClick(id));
    row.appendChild(b);
  });
}

async function renderFaceControls() {
  if (!pet) return;
  const r = pet.renderer;
  const caps = (r && r.capabilities) || {};
  fillRow('expr-section', 'expr-row',
    caps.expression ? r.listExpressions().map((e) => ({ id: e.id, label: e.label })) : [],
    (id) => { manualHold(); pet.setExpression(id); log('表情: ' + id); });
  fillRow('gesture-section', 'gesture-row',
    caps.gesture ? [...r.listGestures().map((g) => ({ id: g, label: g })), { id: null, label: '清除' }] : [],
    (id) => { manualHold(); pet.setGesture(id); log('手势: ' + (id || '清除')); });
  const pack = await pet.voicePack();
  fillRow('voice-section', 'voice-row',
    pack ? pack.lines.map((l) => ({ id: l.id, label: l.label || l.id, title: l.text })) : [],
    async (id) => { const res = await pet.voice(id); log('语音: ' + id + (res.played ? '' : ' ✗ ' + res.reason)); });
}
```

在 `rebuild()` 里 `log('已加载 ' + ...)` 这一行之后加：

```js
    pet.on('speech', ({ phase, text, reason }) => { if (phase === 'end' && reason) log('🔇 未出声: ' + reason + ' · ' + text); });
    renderFaceControls();
```

在 `bindControls()` 里 `bindViewControls();` 之前加：

```js
  const speakInput = document.getElementById('speak-input');
  const doSpeak = () => { if (pet && speakInput.value.trim()) { pet.speak(speakInput.value.trim()); log('说: ' + speakInput.value.trim()); } };
  document.getElementById('speak-btn').addEventListener('click', doSpeak);
  speakInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSpeak(); });
  document.getElementById('speak-stop').addEventListener('click', () => { if (pet) pet.stopSpeak(); });
```

- [ ] **Step 5: chat 页面**

`chat/index.html`：`<link rel="stylesheet" href="chat.css" />` 之后加同 Step 2 的 importmap；`<div id="pet-mount"></div>` 之后加：

```html
      <button id="mute-btn" type="button" class="mute-btn"></button>
```

`chat/chat.css` 末尾（`@media` 之前）加：

```css
.mute-btn {
  padding: 6px 14px; border-radius: 9px; border: 1px solid var(--line-hi);
  background: var(--card); color: var(--muted); font-size: 13px; cursor: pointer;
}
.mute-btn:hover { color: var(--fg); background: var(--card-hi); }
```

- [ ] **Step 6: chat 逻辑**

`chat/chat.js`：

1. 顶部常量区加：

```js
const MUTE_KEY = 'petsking_muted';
const muteBtn = document.getElementById('mute-btn');
let muted = localStorage.getItem(MUTE_KEY) === '1';
let hadText = false;
```

2. `loadPetName()` 改为返回 manifest：函数开头 `let name = PET_ID;` 后加 `let manifest = null;`，`const manifest = await res.json();` 改为 `manifest = await res.json();`，函数末尾加 `return manifest;`。

3. `mountPet()` 改为接收 manifest，按素材包渲染器与比例挂载：

```js
async function mountPet(manifest) {
  const aspect = (manifest && (manifest.aspect || (manifest.geometry && manifest.geometry.aspect))) || 1;
  pet = await createPet({
    pet: PET_ID,
    petsBaseUrl: '../pets/',
    driver: 'chain',
    container: '#pet-mount',
    corner: 'center',
    size: aspect < 1 ? Math.round(400 * aspect) : 360,   // 竖长的 3D 角色按 400px 高度算宽
    draggable: false,
    ai: { enabled: true },
    autoStart: true,
  });
  applyMute();
}

function applyMute() {
  muteBtn.textContent = muted ? '🔇 已静音' : '🔊 朗读回复';
  if (!pet) return;
  pet.voiceEnabled = !muted;
  if (muted) pet.stopSpeak();
}

muteBtn.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  applyMute();
});
```

4. WebSocket `message` 处理里：
   - `text_delta` 分支里 `assistantBubble.textContent += msg.delta;` 之后加 `hadText = true;`
   - `action` 分支改为（回复会被朗读时，意图自带的台词语音跳过，避免两段语音叠在一起）：

```js
    } else if (msg.type === 'action') {
      if (pet) pet.react(msg.intent, { silent: pet.voiceEnabled });
```

   - `done` 分支里 `if (assistantBubble && pet) pet.say(assistantBubble.textContent, 4000);` 改为：

```js
      if (assistantBubble && pet) {
        // 有真实回复文字才朗读（speak 自带气泡）；占位提示只冒泡
        if (hadText) pet.speak(assistantBubble.textContent);
        else pet.say(assistantBubble.textContent, 4000);
      }
      hadText = false;
```

5. `start()` 里把 manifest 传下去：`await loadPetName();` 改为 `const manifest = await loadPetName();`，
   `await mountPet();` 改为 `await mountPet(manifest);`（`loadHistory` 保持在两者之间不动）。

- [ ] **Step 7: 起服务冒烟**

Run: `(bun run server > /tmp/petsking.log 2>&1 &) ; sleep 2; curl -s -o /dev/null -w '%{http_code} ' http://localhost:8787/playground/?pet=qingxiao; curl -s -o /dev/null -w '%{http_code} ' http://localhost:8787/pets/qingxiao/pet.json; curl -sI http://localhost:8787/pets/qingxiao/assets/model.glb | grep -i -E '^(HTTP|content-length)'; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/pets/qingxiao/assets/voices/hello.mp3`
Expected: `200 200`、GLB 的 `HTTP/1.1 200` 与 `Content-Length: 41065204`、`200`。（服务保留运行供 Task 18 使用。）

- [ ] **Step 8: Commit**

```bash
git add dashboard/dashboard.js playground/index.html playground/playground.js chat/index.html chat/chat.js chat/chat.css
git commit -m "feat(ui): dashboard gltf 分组；playground 表情/手势/语音/说话面板；chat 按素材包渲染器挂载并朗读回复"
```

---

### Task 18: 浏览器验证（手测，用 chrome-devtools / playwright MCP）

**Files:** 无（发现问题回到对应 Task 修，并把模型侧问题记到 `docs/model-change-requests.md`）

- [ ] **Step 1: playground 加载清霄**

打开 `http://localhost:8787/playground/?pet=qingxiao`，等加载条走完。检查：
- 角色全身入框、透明背景（切「棋盘格」背景可见棋盘）、脚下有软阴影；console 无报错（`list_console_messages`）。
- 截图存档。

- [ ] **Step 2: 动作**

依次点 `idle`、`fidget-1..3`、`walk-left`、`walk-right`、`run`：
- fidget 播一遍后自动回到 `Stand2`。
- walk-left 身体转向屏幕左（约 70°），walk-right 转向右；切回 idle 转回正面。
- 若左右转反：把 `pets/qingxiao/pet.json` 的 yaw 符号对调，并在 `gltf.js` 头注释更正「正 = 朝屏幕右」。

- [ ] **Step 3: 走动步速**

切 chain 驱动等它走动（或序列 `walk-left`）：观察脚与地面是否打滑。明显打滑时在 walk 动作上加 `"speedScale"`（如 0.9 / 1.1）微调，记录最终值。

- [ ] **Step 4: 表情 / 手势**

点每个表情（害羞应有腮红）；点 6 个手势：nod 点两下头、shake 摇头、tilt 歪头保持、lookUp 抬头、lookDown 低头、lean 前倾；「清除」淡回。
- 若某手势方向反了（如 lookDown 变成抬头）：只改 `gesture-curves.js` 里对应分量的符号，重跑 `bun test pet-lib`（测试断言 lookDown x>0，若改的是 x 的符号约定，同步更新测试与文件头坐标说明）。

- [ ] **Step 5: 语音 + 口型**

先点一下页面（解锁音频），点每条语音台词：有声音、嘴随音频开合、气泡显示台词、台词表情生效并在说完后恢复。
在「说话」输入框输入文字回车：浏览器 TTS 出声（若系统有中文语音）且嘴按字开合。

- [ ] **Step 6: Agent 状态联动**

点模拟事件：thinking → 歪头 + 「嗯……容我想想」；完成✓ → 点头微笑 + 「完成了，辛苦」；失败✗ → 低头难过 + 「出错了…」；需审批 → 抬头 + 「有新消息…」；idle → 表情/手势恢复。8 秒内连续触发只出一次语音（冷却）。

- [ ] **Step 7: 尺寸 / 拖拽 / 切换**

拖动大小滑条：画面随容器缩放不变形。拖拽宠物可移动。切换驱动、刷新页面多次：console 无 WebGL context 泄漏警告。

- [ ] **Step 8: dashboard 与 chat**

`/dashboard/` 出现「🧍 GLTF 3D 角色」分组，清霄卡片有「💬 互动」；三只 webm 宠物的「互动」入口仍在。
登录后进 `/chat/?pet=qingxiao`：清霄挂载正常；发消息后回复被朗读（嘴动）+ 气泡；perform_action 触发表情/手势且不与朗读叠音；点「🔇」后只冒泡。
`/chat/?pet=blue-whale` 行为与改动前一致（webm 渲染器，回复浏览器 TTS 朗读、无口型）。

- [ ] **Step 9: 记录并提交修正**

把验证中做的调整（yaw 符号、speedScale、手势符号等）提交；模型侧问题追加到 `docs/model-change-requests.md`：

```bash
git add -A pets/qingxiao/pet.json pet-lib docs/model-change-requests.md
git commit -m "fix(gltf): 浏览器验证后的朝向/步速/手势参数修正"
```

（没有修正则跳过此步。）

---

### Task 19: 文档

**Files:**
- Modify: `pet-lib/README.md`、`README.md`
- Modify: `docs/superpowers/specs/2026-10-13-gltf-character-skin-design.md`

- [ ] **Step 1: `pet-lib/README.md`**

1. 开头「六种」改「七种」，渲染器列表加 `gltf`。
2. 「安装 / 引入」的 importmap 示例替换为 Task 17 Step 2 的 0.170 + addons 版本，并追加：

```markdown
**作为依赖引入（Vite / bun 等打包器）**：

    bun add github:claw-works/petsking#main   # 或 workspace / 本地路径
    bun add three                              # 用 three / gltf 渲染器时需要（可选 peer）

```js
import { createPet } from '@claw-works/pet-lib';
import { Voice, browserTts } from '@claw-works/pet-lib/voice';
```
```

3. 「配置项」表追加：

```markdown
| `voice.enabled` | bool | `true` | `false` 时 `voice()/speak()` 只冒泡 |
| `voice.tts` | fn | 浏览器 TTS | `(text,{lang}) => Promise<音频(Blob\|ArrayBuffer\|typed array\|url) \| {done, cancel?} \| null>`；音频 → 音频驱动口型；`{done, cancel?}` → provider 自己出声、按字估算口型；`null` → 无 TTS（`reason:'no-tts'`） |
| `voice.lang` | string | `'zh-CN'` | TTS 语言 |
| `voice.cooldownMs` | number | `8000` | 状态机 / 意图自动语音的冷却 |
```

4. 「驱动函数」表追加：

```markdown
| `pet.setExpression(name)` | 切表情（渲染器支持时，如 gltf） |
| `pet.setGesture(name\|null)` | 头部小动作：`nod/shake/tilt/lookUp/lookDown/lean` |
| `pet.voice(lineId)` | 播预录台词（音频 + 口型 + 气泡 + 台词表情） |
| `pet.speak(text)` | 任意文字说话（TTS provider） |
| `pet.stopSpeak()` | 停止说话 |
| `pet.perform(perf)` | 执行表演对象 |
| `pet.voicePack()` | 语音包（Promise） |
```

5. 新增一节「表演对象」：

```markdown
## 表演对象（stateActions / intentMap / chain.clicks）

值可以是动作名字符串，也可以是对象：

```jsonc
{ "action": "idle", "expression": "sad", "gesture": "lookDown", "voice": "error", "say": "…", "holdMs": 3000 }
```

- 状态（stateActions）：进入状态时切表情 / 手势、播语音；离开时恢复。
- 意图（intentMap）/ 点击（clicks）：一次性，表情/手势保持 `holdMs` 后恢复。
- 渲染器不支持的部分自动忽略（webm 宠物也能用 voice/say）。
```

6. 「各渲染器的 actions 格式」追加：

```markdown
- `gltf`：`model`、`camera`(`full`/`bust`/对象)、`turnDeg`、`voices`；`actions:{动作:"Clip" | {clip, once, yaw, speed, speedScale}}`，见 `renderers/gltf.js` 头注释
```

7. 示范包列表加 `qingxiao`(gltf)。

- [ ] **Step 2: 根 `README.md`**

- 特性里「六种渲染载体」→「七种」，追加 `gltf` 3D 角色（骨骼动画 + 表情 + 口型 + 语音）。
- 「快速开始」`bun run server` 前加一行：`tools/sync-qingxiao-assets.sh   # 可选：同步清霄 3D 模型与语音（不进 git）`
- 「角色培养聊天」段：聊天宠物改为 `pets/index.json` 里 `chat: true` 的宠物（blue-whale / 残红 / 早雾 / 清霄），清霄会朗读回复。
- 仓库结构 `pet-lib/` 下加 `voice/  语音层：lipsync / TTS provider / 语音包`。

- [ ] **Step 3: spec 与实现对齐**

在 spec「左右走」小节把「pet.json `walk.turnDeg`」改为「pet.json 顶层 `turnDeg`（setFacing 用），走动动作自带 `yaw`（`walk-left: -70` / `walk-right: 70`）」；「步速匹配」里 `walk.speedScale` 改为「动作上的 `speedScale`」；「走动动作开始时 DeskPet 先调 renderer.setFacing」一句改为「走动动作通过自身 `yaw` 转身，无需 DeskPet 调 setFacing」。

- [ ] **Step 4: Commit**

```bash
git add pet-lib/README.md README.md docs/superpowers/specs/2026-10-13-gltf-character-skin-design.md
git commit -m "docs: gltf 渲染器、语音/表演 API、清霄素材同步与聊天说明"
```
