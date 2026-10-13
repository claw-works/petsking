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
- 不制作新的骨骼动画 clip。挥手 / 欢呼等全身大动作需要在 DCC 里做或重定向后导出进 GLB，属于素材工作；
  素材包结构已支持，加 clip 后只改 pet.json。

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
| `setGesture(name \| null)` / `listGestures()` | 程序化头部 / 上身小动作（见下） |
| `get capabilities` | `{ expression, mouth, gesture }`（bool），playground 据此决定显示哪些面板 |

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
  `full` 不再只按待机姿势的身高取景：加载时把每个动作 clip（按各自 yaw，待机另加 ±turnDeg）逐帧采样，记录模型顶点的
  包络盒与每帧轮廓点，`fitCamera` 按当前容器宽高比逐点求相机距离，高宽两个方向都装下并四周留 `framePadding`（默认 10%）；
  容器尺寸变化时重新装框。可用 `frameBox` 手动指定包络跳过采样。
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
  "walk-left":  { "clip": "Walk_F", "yaw": -70, "speed": 1.011 },   // 身体转向（度）
  "walk-right": { "clip": "Walk_F", "yaw": 70,  "speed": 1.011 },
  "run":        "Run_F"
}
```

- `once: true` 的 clip 不管 `meta.loop` 都只播一遍，播完淡回 `idle` 动作的 clip，并调用 `_onEnded`。
  （概率链对所有动作都发 `loop:true`，待机小动作循环十几秒会很怪，所以由素材声明决定。）
- 禁用 Character 内部的 idle director（`idleVariants` 置空），待机小动作由 chain 驱动的 idle 池调度，与 pet-lib 驱动模型一致。
- **左右走 = 转模型，不转镜头**：灯光固定在世界空间，转镜头会让侧面光影跳变；镜头不动则待机/走路取景一致。
  - `setFacing('left'|'right')` → 身体 yaw ∓`turnDeg`（pet.json 顶层 `turnDeg`，默认 70°，3/4 侧身，脸仍可见），沿用
    Character 现有的平滑转身（`_targetYaw`，约 0.2s）；`front` → 0。
  - 走动动作通过自身 `yaw`（`walk-left: -70` / `walk-right: 70`）转身，无需 DeskPet 调 `setFacing`；`setFacing` 仅用于手动朝向，`turnDeg` 是它的顶层配置。
  - **步速匹配**：渲染器提供 `getWalkSpeedPx(action)`：clip 的 m/s（`locomotion` 配置，Walk_F = 1.011）× 每米像素数
    （由相机 fov、相机到角色距离和容器高度算出）× sin(turnDeg)（斜向走时屏幕上只看到水平分量）。
    DeskPet `_startMove` 优先用它，渲染器不提供时回落 `walk.speed`。若实测脚步仍有滑动，动作上的 `speedScale` 可微调。

**头部小动作层（gesture）**：程序化叠加在骨骼动画之上，让各 Agent 状态在身体上也有区分，无需新 clip。

- 新文件 `pet-lib/renderers/_gltf-gestures.js`。每帧在 `mixer.update()` 之后、弹簧骨骼之前，对 `Bip001Head`、
  `Bip001Neck`、`Bip001Spine2` 的 quaternion **右乘**一个小旋转（加性叠加，不覆盖 clip 本身的动作）。
- 内置手势（参数化的时间函数，权重 0→1 淡入、结束淡出 0.3s）：

  | 名字 | 表现 | 典型用途 |
  |---|---|---|
  | `nod` | 点头 2 次（头 pitch） | 完成、同意 |
  | `shake` | 摇头（头 yaw） | 否定 |
  | `tilt` | 歪头并保持（头 roll + 微 pitch） | 思考、疑惑 |
  | `lookUp` | 抬头看向上方并保持 | 思考 |
  | `lookDown` | 低头并保持 | 出错、难过 |
  | `lean` | 上身前倾并保持（Spine2 pitch + 头回正） | 等用户、关注 |

- **先还原再叠加（累积修复）**：clip 只有两个相同关键帧时 mixer 不会每帧重写骨骼，叠加偏移会逐帧累积。因此 `update()` 记下被改骨骼的原始 quaternion，
  Character 在下一帧 `mixer.update()` 之前先调 `restore()` 还原，再由 `update()` 叠加；手势结束后也不残留。
- 持续型（tilt/lookUp/lookDown/lean）一直保持到下一个 gesture 或 `setGesture(null)`；一次型（nod/shake）播完自动归零。
- 骨骼名可在 pet.json `gestureBones: { head, neck, spine }` 覆盖，默认 Bip001 命名；找不到骨骼则该手势静默跳过。
- 渲染器接口：`setGesture(name | null)`、`listGestures()`；`capabilities.gesture = true`。

**three 版本**：importmap 统一升到 `three@0.170.0`，并加 `"three/addons/": ".../three@0.170.0/examples/jsm/"`
（GLTFLoader 需要）。已有 `_three-model.js` 只用核心 API，0.160→0.170 兼容。

### 2. 语音层 `pet-lib/voice/`

- `lipsync.js` — 移植 qingxiao `AudioLipSync`。它只分析音频信号（响度 + 频带），不依赖音素时间线，所以**对任意来源的语音都通用**：
  预录 mp3、云 TTS 返回的音频、将来的克隆音色。改动：`play(src)` 接受 URL / `Blob` / `ArrayBuffer`；
  特征计算（rms 自适应、频带比 → `{open, wide, round}`）抽成纯函数 `mouthFeatures(timeData, freqData, sampleRate, fftSize, state)` 便于单测。
- `visemes.js` — `charToViseme` + `textToVisemeTimeline(text)`（纯函数），用于没有音频流时按字估算口型。
- `voice-pack.js` — `loadVoicePack(url)` → `{ lines, get(id), url(line) }`，相对路径按 index.json 所在目录解析。
- `tts.js` — provider 接口与默认实现：

  ```js
  // provider: (text, { lang }) => Promise<音频 | { done, cancel? } | null>
  //   返回音频（Blob / ArrayBuffer / typed array / url）→ 走 lipsync 音频口型
  //   返回 { done, cancel? } → provider 自己出声（如浏览器 TTS），走按字估算口型；被打断时调 cancel
  //   返回 null → 无可用 TTS，返回 { played: false, reason: 'no-tts' }
  // 默认 browserTts 返回 { done, cancel }（speechSynthesis 自己出声，库估算口型直到 done）
  ```

  `voice()/speak()` 的结果为 `{ played, reason?, interrupted? }`，`reason` ∈ locked / error / tts-error / no-tts / no-src / empty / cooldown / unknown-line / disabled / destroyed。

- `voice.js` — `Voice` 类，DeskPet 持有一个实例：
  - 每帧把 lipsync 特征或 viseme 时间线推给 `renderer.setMouth()`（自己的 RAF，只在说话时运行）。
  - 同一时刻只有一段语音；新语音打断旧语音。
  - `unlock()`：在第一次用户 pointerdown 时 resume AudioContext（浏览器自动播放策略）。未解锁时 `voice()`/`speak()` 不报错，
    返回 `{ played: false, reason: 'locked' }`，气泡照常显示。

**DeskPet 新增 API**：

| 方法 | 说明 |
|---|---|
| `pet.setExpression(name)` | 转发渲染器 |
| `pet.voice(lineId, { expression? })` | 播预录台词：音频 + 口型 + 气泡（台词文字）+ 台词自带表情（进说话层），说完 0.7s 清除。返回 Promise |
| `pet.speak(text, { expression? })` | 任意文字：调 TTS provider → 音频口型或估算口型 + 气泡。返回 Promise |
| `pet.stopSpeak()` | 停止当前语音 |
| `pet.on('speech', cb)` | `{ phase: 'start' \| 'end', text, lineId? }` |

**createPet 新增配置**：

```js
voice: {
  enabled: true,          // 默认 true；false 时 voice()/speak() 只冒泡
  tts: browserTts,        // 可插拔 provider
  lang: 'zh-CN',
  cooldownMs: 8000,       // 状态机/意图触发的语音冷却（手动调用与点击语音不受限）
}
```

### 3. 「表演」（performance）统一

`stateActions`、`intentMap`、`chain.clicks` 的值都允许是字符串（现状，向后兼容）或对象：

```jsonc
"stateActions": {
  "THINKING":         { "action": "idle", "expression": "neutral", "gesture": "tilt",     "voice": "thinking" },
  "WAITING_FOR_USER": { "action": "idle", "expression": "neutral", "gesture": "lean",     "voice": "wait" },
  "SUCCESS":          { "action": "idle", "expression": "smile",   "gesture": "nod",      "voice": "done" },
  "ERROR":            { "action": "idle", "expression": "sad",     "gesture": "lookDown", "voice": "error" }
},
"intentMap": {
  "happy": { "action": "fidget-1", "expression": "happy" },
  "greet": { "action": "fidget-3", "expression": "smile", "voice": "hello" }
}
```

- 新增纯函数 `pet-lib/core/performance.js`：`resolvePerformance(value) → { action, expression?, gesture?, voice?, say? } | null`。
- StateDriver / ChainDriver 用它解析，`_emit(action, { ...meta, expression, gesture, voice })`。
- AgentBridge.reactTo 用它解析，然后调 `pet.perform(perf, meta)`。
- `DeskPet.perform(perf, meta)`（新，内部也给 onAction 用）：播动作 → 有 `expression` 则切表情 → 有 `gesture` 则 `setGesture` → 有 `voice` 则在冷却外 `pet.voice()`。
- **表情 / 手势分层解析**（`pet-lib/core/look.js`，纯函数 `resolveLook`）：不再由各处 save/restore，而是每个来源只写自己那一层，统一解析后下发（结果变化才下发）：
  - 表情：talk（台词自身表情，`neutral` 视为未设置）> manual（`setExpression`，传 `'neutral'` 清除）> react（意图/点击，`holdMs` 默认 3s）> state（驱动状态）> `neutral`
  - 手势：manual（`setGesture`，传 `null` 清除）> react > state；说话不碰手势。
  - 点击的表情/手势进 react 层，不动 state 层；离开状态时 state 层随下一个驱动动作替换，不残留。
- **概率链**：`chain.playMs` 可为数字、函数或 `{ "<action>": ms, "default": ms }`（待机小动作 clip 长达十几~四十几秒，按动作声明）；
  点击/意图表演调用 `driver.hold()` 让链条让路，避免反应刚开始就被覆盖；走动走到屏幕边缘时立即触发下一次挑选。
- `aspect`（pet.json 顶层）控制舞台高度，由 config 透传给渲染器 / 布局。

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
- **playground**：渲染器 `capabilities.expression` 时显示表情按钮行，`capabilities.gesture` 时显示手势按钮行；pack 有 `voices` 时显示语音台词按钮行；
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
  - `renderers/_gltf-gestures` 的手势时间函数（纯函数部分）：权重淡入淡出、一次型结束归零。
  - `voice/voice-pack.test.js`：相对路径解析、`get(id)`。
  - `server/pet-registry.test.js`：改为按 `chat: true` 收录。
- 浏览器手测（playground / chat）：加载清霄、动作切换、表情、手势、左右走转身与步速、预录语音口型、任意文字说话、状态机事件联动语音、拖拽、
  setSize、切换渲染器后销毁无泄漏、聊天朗读与静音。
