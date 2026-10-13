# GLTF 3D 角色皮肤（清霄）+ 通用表情/语音能力 设计文档

日期：2026-10-13

## 背景 / 目标

`/Users/wellxie/projects/tmp/qingxiao-pet` 已经做好一个 Vite + three.js 的 3D 角色「清霄」：GLB 骨骼动画、morph 表情、
音频驱动口型、预录语音包。这次把它作为一种新的渲染方案接入 pet-lib，并借此把「表情 / 语音 / 说话」做成
pet-lib 的**通用能力**——pet-lib 定位是角色皮肤系统，后续别的项目接 agent、chat 时直接复用这套库。

覆盖范围：

1. pet-lib 新增 `gltf` 渲染器；清霄作为素材包出现在 dashboard，playground 可调动作 / 表情 / 语音 / 任意文字说话。
2. Agent 状态机联动：`agent.thinking` / `task.completed` 等事件 → 动作 + 表情 + 预录语音。
3. 陪伴聊天 `/chat`：清霄可聊天，回复朗读出来，`perform_action` 触发动作 / 表情 / 语音。
4. 任意文本 TTS：可插拔 provider，库不绑厂商。
5. pet-lib 加 `package.json`，保持零构建 ESM，可被别的项目静态引用或作为 git/workspace 依赖引入。

## 非目标

- 不发布 npm、不做构建产物 / 类型声明。
- 不接具体云 TTS（Polly / 克隆音色）——只定义 provider 接口，默认浏览器 TTS。
- 不改现有 `three`（程序化 chibi）渲染器。
- 不移植 qingxiao 的角色卡页、OrbitControls 展示页、头像截图缓存。
- 不做 webm 宠物的口型（webm 宠物也能 `speak`，只是只有声音 + 气泡）。

## 架构

```
Driver ──onAction(action, meta{expression?, voice?})──► DeskPet ──► Renderer.play / setExpression / setMouth
                                                          │
                                                          └──► Voice（音频播放 + 口型分析 + TTS）──mouth 帧──► Renderer.setMouth
```

渲染器只负责「画」，语音层独立于渲染器。不支持某能力的渲染器忽略对应调用（基类提供空实现）。

### 1. 渲染器层

**`RendererBase` 新增可选能力**（基类空实现，向后兼容）：

| 方法 | 说明 |
|---|---|
| `setExpression(name)` | 切表情预设；未知名字回落 `neutral` |
| `listExpressions()` | 返回 `[{ id, label }]`，默认 `[]` |
| `setMouth(frame \| null)` | 口型帧。`{ open, wide, round }`（音频分析，0..1）或 `{ viseme }`（按字估算）；`null` 闭嘴 |
| `get capabilities` | `{ expression: bool, mouth: bool }`，playground 据此决定显示哪些面板 |

**新文件**：

- `pet-lib/renderers/gltf.js` — `GltfRenderer`，注册为 `gltf`。懒加载 `_gltf-character.js`（与 `three.js` 懒加载 `_three-model.js` 同模式）。
- `pet-lib/renderers/_gltf-character.js` — 从 qingxiao `src/character.js` 移植的 `Character` 类，去掉内部语音逻辑
  （`sayClip`/`speak`/`stopSpeak`/`lipsync` 移到语音层），保留动作、表情、眨眼、blush、fur、viseme/音频特征→morph 映射，
  对外暴露 `setMouth(frame)`。表情预设 `EXPRESSIONS` 移到素材包可覆盖：pet.json 的 `expressions` 有则用，没有用内置默认。
- `pet-lib/renderers/_springbones.js` — 原样移植。

**场景（桌宠模式）**：

- `WebGLRenderer({ alpha: true })` 透明背景，无地面网格，只留 `ShadowMaterial` 软阴影圆盘（可关）。
- 灯光沿用 qingxiao 的 key/fill/top/front/rim/hemisphere 组合，ACES tone mapping。
- 固定相机，无 OrbitControls（拖拽交给 DeskPet 移动整只宠物）。取景由 pet.json `camera` 决定：
  `"full"`（全身，默认）/ `"bust"`（半身，以 `Bip001Head` 骨骼定位）/ 或 `{ position, target, fov }` 显式指定。
  加载后按模型包围盒高度自动对焦（qingxiao `resetStage` 的算法）。
- `useRootMotion = false`，原地走跑；水平位移复用 DeskPet 现有 `pack.walk` 的 px 平移。
- 容器尺寸变化用 `ResizeObserver`（不是 window resize），因为 playground 会运行时 `setSize`。
- `destroy()` 释放 geometry / material / texture、停 RAF、移除 canvas。
- 加载进度：`mount()` 期间在 stage 里显示一个简单进度条（GLB 41MB），加载失败抛错并显示错误文字。

**动作映射**（pet.json `actions`）：值可以是 clip 名字符串，或对象：

```jsonc
"actions": {
  "idle":       "Stand2",
  "fidget-1":   { "clip": "Stand1_Action01", "once": true },   // 播一遍回 idle clip，并触发 onEnded
  "walk-left":  { "clip": "Walk_F", "yaw": -90 },              // 身体转向（度）
  "walk-right": { "clip": "Walk_F", "yaw": 90 },
  "run":        "Run_F"
}
```

- `once: true` 的 clip 不管 `meta.loop` 都只播一遍，播完淡回 `idle` 动作的 clip，并调用 `_onEnded`。
  （概率链对所有动作都发 `loop:true`，待机小动作循环十几秒会很怪，所以由素材声明决定。）
- 禁用 Character 内部的 idle director（`idleVariants` 置空），待机小动作由 chain 驱动的 idle 池调度，与 pet-lib 驱动模型一致。
- `setFacing('left'|'right')` → 身体 yaw ∓90°，平滑转身；`front` → 0。

**three 版本**：importmap 统一升到 `three@0.170.0`，并加 `"three/addons/": ".../three@0.170.0/examples/jsm/"`
（GLTFLoader 需要）。已有 `_three-model.js` 只用核心 API，0.160→0.170 兼容。

### 2. 语音层 `pet-lib/voice/`

- `lipsync.js` — 移植 qingxiao `AudioLipSync`。改动：`play(src)` 接受 URL / `Blob` / `ArrayBuffer`；
  特征计算（rms 自适应、频带比 → `{open, wide, round}`）抽成纯函数 `mouthFeatures(timeData, freqData, sampleRate, fftSize, state)` 便于单测。
- `visemes.js` — `charToViseme` + `textToVisemeTimeline(text)`（纯函数），用于没有音频流时按字估算口型。
- `voice-pack.js` — `loadVoicePack(url)` → `{ lines, get(id), url(line) }`，相对路径按 index.json 所在目录解析。
- `tts.js` — provider 接口与默认实现：

  ```js
  // provider: (text, { lang, voice }) => Promise<Blob | ArrayBuffer | string(url) | null>
  //   返回音频 → 走 lipsync 音频口型；返回 null → 表示 provider 自己出声（如浏览器 TTS），走按字估算口型
  export const browserTts = async (text, { lang = 'zh-CN' } = {}) => { /* speechSynthesis.speak */ return null; };
  ```

- `voice.js` — `Voice` 类，DeskPet 持有一个实例：
  - 每帧把 lipsync 特征或 viseme 时间线推给 `renderer.setMouth()`（自己的 RAF，只在说话时运行）。
  - 同一时刻只有一段语音；新语音打断旧语音。
  - `unlock()`：在第一次用户 pointerdown 时 resume AudioContext（浏览器自动播放策略）。未解锁时 `voice()`/`speak()` 不报错，
    返回 `{ played: false, reason: 'locked' }`，气泡照常显示。

**DeskPet 新增 API**：

| 方法 | 说明 |
|---|---|
| `pet.setExpression(name)` | 转发渲染器 |
| `pet.voice(lineId, { expression? })` | 播预录台词：音频 + 口型 + 气泡（台词文字）+ 台词自带表情，说完 0.7s 恢复原表情。返回 Promise |
| `pet.speak(text, { expression? })` | 任意文字：调 TTS provider → 音频口型或估算口型 + 气泡。返回 Promise |
| `pet.stopSpeak()` | 停止当前语音 |
| `pet.on('speech', cb)` | `{ phase: 'start' \| 'end', text, lineId? }` |

**createPet 新增配置**：

```js
voice: {
  enabled: true,          // 默认 true；false 时 voice()/speak() 只冒泡
  tts: browserTts,        // 可插拔 provider
  lang: 'zh-CN',
  cooldownMs: 8000,       // 状态机/意图触发的语音冷却（手动调用不受限）
}
```

### 3. 「表演」（performance）统一

`stateActions`、`intentMap`、`chain.clicks` 的值都允许是字符串（现状，向后兼容）或对象：

```jsonc
"stateActions": {
  "THINKING": { "action": "idle", "expression": "neutral", "voice": "thinking" },
  "SUCCESS":  { "action": "fidget-2", "expression": "happy", "voice": "done" },
  "ERROR":    { "action": "idle", "expression": "sad", "voice": "error" }
},
"intentMap": {
  "happy": { "action": "fidget-1", "expression": "happy" },
  "greet": { "action": "fidget-3", "expression": "smile", "voice": "hello" }
}
```

- 新增纯函数 `pet-lib/core/performance.js`：`resolvePerformance(value) → { action, expression?, voice?, say? } | null`。
- StateDriver / ChainDriver 用它解析，`_emit(action, { ...meta, expression, voice })`。
- AgentBridge.reactTo 用它解析，然后调 `pet.perform(perf, meta)`。
- `DeskPet.perform(perf, meta)`（新，内部也给 onAction 用）：播动作 → 有 `expression` 则切表情 → 有 `voice` 则在冷却外 `pet.voice()`。
- 离开某状态时，如果该状态设过表情，恢复 `neutral`（状态表情不残留）。

### 4. 清霄素材包 `pets/qingxiao/`

```
pets/qingxiao/
  pet.json       renderer: gltf；model、camera、expressions(可选)、actions、chain、stateActions、intentMap、voices、walk
  soul.md        人设（基于语音包台词的语气：沉稳、简短、护着用户）
  assets/        model.glb + voices/{index.json, *.mp3}   ← 已被 .gitignore 的 pets/*/assets/ 忽略
```

- pet.json 新字段：`"model": "model.glb"`、`"voices": "voices/index.json"`（都相对 assetsDir）、`"camera": "full"`、`"aspect": 0.6`。
- `config.js` 的透传字段列表加 `model`（已有）、`camera`、`expressions`、`voices`。
- `pets/index.json` 加一条：`{ "id": "qingxiao", "name": "清霄", "renderers": ["gltf"], "path": "qingxiao/pet.json", "chat": true }`。
- 素材文件不进 git：`pets/qingxiao/README.md` 写明从 qingxiao-pet 的 `assets/qingxiao/model.glb` 与 `assets/voices/qingxiao/`
  拷贝到 `pets/qingxiao/assets/`；`tools/` 下加一个 `sync-qingxiao-assets.sh` 一键拷贝。

### 5. 页面与服务端

- **importmap**：playground、chat 统一 three@0.170 + addons（dashboard 不渲染宠物，不需要）。
- **dashboard**：`RENDERER_GROUPS` 加 `gltf: { icon: '🧍', name: 'GLTF 3D 角色' }`；「互动」入口条件从
  `renderers.includes('webm')` 改为 `pack.chat === true`（webm 三只在 index.json 补 `"chat": true`，行为不变）。
- **playground**：渲染器 `capabilities.expression` 时显示表情按钮行；pack 有 `voices` 时显示语音台词按钮行；
  始终显示「说话」输入框（任意文字 → `pet.speak`）。
- **server**：`pet-registry.js` 收录条件改为 `entry.chat === true`（原「只收 webm」）；intents 依旧取 `intentMap` 的 key，
  对象值不影响。现有测试同步更新。
- **chat**：
  - `createPet` 去掉硬编码 `renderer: 'webm'`，用素材包声明的渲染器。
  - `done` 时：pack 有语音能力 → `pet.speak(回复全文)`（同时冒泡）；否则维持现在的 `pet.say`。
  - 聊天页加一个「🔇 静音」开关（存 localStorage），静音时只冒泡。
  - `action` 消息 → `pet.react(intent)`，表演对象里的 `expression`/`voice` 生效；若同一回合随后要朗读回复，
    意图自带的 `voice` 跳过，避免两段语音叠加（以回复朗读为准）。

### 6. pet-lib 分发

`pet-lib/package.json`：

```json
{
  "name": "@claw-works/pet-lib",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./index.js", "./voice": "./voice/index.js" },
  "peerDependencies": { "three": ">=0.160.0" },
  "peerDependenciesMeta": { "three": { "optional": true } }
}
```

three 只在用 `three`/`gltf` 渲染器时懒加载，所以是可选 peer。README 补「在 Vite/bun 项目里引入」和「静态 importmap 引入」两段。

## 错误处理

- GLB 加载失败：`mount()` reject，stage 显示「模型加载失败」；DeskPet.init 把错误抛给 createPet 调用方。
- 语音包缺失 / 某条 mp3 404：`voice()` resolve `{ played: false, reason }` 并 console.warn，气泡照常显示，不影响动作。
- TTS provider 抛错：降级为按字估算口型 + 气泡，不中断聊天。
- 未知表情 / 未知 lineId：表情回落 neutral；lineId 未知 warn 并忽略。
- 音频未解锁：见语音层 `unlock()`。

## 测试

- `bun test`（扩展 `package.json` 的 test 脚本覆盖 `pet-lib` 下的纯逻辑测试）：
  - `core/performance.test.js`：字符串 / 对象 / 空值解析。
  - `voice/visemes.test.js`：字符 → viseme、时间线时长与收尾 rest。
  - `voice/lipsync.test.js`：`mouthFeatures` 静音闭嘴、响度归一化、高频 → wide。
  - `voice/voice-pack.test.js`：相对路径解析、`get(id)`。
  - `server/pet-registry.test.js`：改为按 `chat: true` 收录。
- 浏览器手测（playground / chat）：加载清霄、动作切换、表情、预录语音口型、任意文字说话、状态机事件联动语音、拖拽、
  setSize、切换渲染器后销毁无泄漏、聊天朗读与静音。
