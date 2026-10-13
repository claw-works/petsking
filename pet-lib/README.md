# pet-lib — 可集成的桌面宠物库

一个**渲染无关、驱动可插拔、程序与素材分离**的桌宠库。同一套 API 可以用
webm / gif / 精灵表 / 像素 canvas / SVG 骨骼 / Three.js 3D / GLTF 角色 七种渲染方式，
用概率链或 Agent 状态机两种驱动方式，并可接入 AI / Agent 事件。

```
import { createPet } from './pet-lib/index.js';
const pet = await createPet({ pet: 'blue-whale' });   // 就这一行，桌宠出现在右下角
```

---

## 架构（四层解耦）

```
驱动 Driver   决定「播哪个动作」   chain 概率链 / statemachine 状态机
    │  onAction(action, meta)
渲染 Renderer 决定「怎么画」       webm/gif/spritesheet/pixel/svg/three/gltf
    │  play(action)
素材 AssetPack 决定「画什么」      pets/<id>/pet.json + 素材文件（与程序分离）
AI 接入 Bridge 归一化外部事件      Agent 事件 → 状态；意图/情绪 → 表演
```

- **程序**在 `pet-lib/`，**素材**在 `pets/`，互不耦合。换宠物 = 换一个 `pet.json`。
- 渲染器、驱动都走**注册表**，可自行扩展。

---

## 安装 / 引入

纯 ESM，无需打包工具。静态服务器托管即可（webm/gif/json 要经 HTTP 加载）：

```sh
python3 -m http.server 8799
```

```js
import { createPet } from './pet-lib/index.js';
```

> 用到 `three` / `gltf` 渲染器时，页面需提供 importmap（`gltf` 还需要 addons 给 GLTFLoader）：
> ```html
> <script type="importmap">
> { "imports": {
>   "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
>   "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
> } }
> </script>
> ```

**作为依赖引入（Vite / bun 等打包器）**：

    bun add github:claw-works/petsking#main   # 或 workspace / 本地路径
    bun add three                              # 用 three / gltf 渲染器时需要（可选 peer）

```js
import { createPet } from '@claw-works/pet-lib';
import { Voice, browserTts } from '@claw-works/pet-lib/voice';
```

---

## 快速开始

```js
// 1) 最简：默认概率链自主陪伴
const pet = await createPet({ pet: 'blue-whale' });

// 2) 指定渲染器 / 驱动 / 场景 / 尺寸
const pet = await createPet({
  pet: 'pixel-puff',
  renderer: 'pixel',
  driver: 'chain',
  scene: 'desktop-corner',
  size: 240,
  container: '#my-mount',   // 缺省挂 body
});

// 3) 接 AI / Agent：反映工作状态
const pet = await createPet({ pet: 'blue-whale', driver: 'statemachine', ai: { enabled: true } });
pet.feed({ type: 'agent.thinking' });          // 标准事件
pet.bridge.dispatch({ type: 'tool/call', tool: 'edit' });  // 原始事件自动归一化
pet.react('happy');                            // 意图/情绪表演
```

---

## 配置项（createPet 的参数）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `pet` | string \| object | 必填 | 素材包 id（`pets/<id>/pet.json`）、pet.json 的 url，或内联素材对象 |
| `petsBaseUrl` | string | `'pets/'` | 素材包根目录 |
| `renderer` | string | 素材包声明 | `webm`/`gif`/`spritesheet`/`pixel`/`svg`/`three`/`gltf` |
| `driver` | string | `'chain'` | `chain`（自主）/ `statemachine`（Agent 驱动） |
| `driverConfig` | object | `{}` | 覆盖驱动参数 |
| `scene` | string \| object | `'desktop-corner'` | 布局预设：`desktop-corner`/`desktop-free`/`chat-inline`/`fullscreen-center` |
| `size` | number | `300` | 宠物宽度 px |
| `corner` | string | 场景决定 | `bottom-right`/`bottom-left`/`top-*`/`center` |
| `margin` | {x,y} | 场景决定 | 距角落偏移 |
| `draggable` | bool | 场景决定 | 是否可拖拽 |
| `container` | HTMLElement\|selector | `body` | 挂载点 |
| `autoStart` | bool | `true` | 创建后自动开始 |
| `ai.enabled` | bool | `false` | 启用 AgentBridge（`pet.feed`/`pet.react`） |
| `ai.eventMap` | object | — | 自定义「原始事件名→标准事件」映射 |
| `ai.intentMap` | object | — | 自定义「意图→动作」映射 |
| `ai.llm.complete` | fn | — | 注入模型调用，启用 LlmAdapter（`pet.llm.react`） |
| `voice.enabled` | bool | `true` | `false` 时 `voice()/speak()` 只冒泡 |
| `voice.tts` | fn | 浏览器 TTS | `(text,{lang}) => Promise<audio \| {done,cancel?} \| null>`，见下方「TTS provider」 |
| `voice.lang` | string | `'zh-CN'` | TTS 语言 |
| `voice.cooldownMs` | number | `8000` | 状态机 / 意图自动语音的冷却（点击触发的语音不受冷却限制） |

---

## 驱动函数（createPet 返回的 pet 对象）

| 方法 | 说明 |
|------|------|
| `pet.start()` / `pet.stop()` | 启停驱动 |
| `pet.play(action, meta)` | 手动播一个动作（`meta.loop`） |
| `pet.feed(event)` | 喂标准 Agent 事件（statemachine 驱动） |
| `pet.react(intent)` | 意图/情绪一次性表演（需 `ai.enabled`） |
| `pet.clickAction()` | 触发点击回应 |
| `pet.setDriver(type, config)` | 运行时切驱动 |
| `pet.setRenderer(type)` | 运行时切渲染器 |
| `pet.setFacing('front'\|'left'\|'right')` | 设朝向 |
| `pet.setPosition(x, y)` | 设位置 |
| `pet.say(text, ms)` | 冒泡说话 |
| `pet.setExpression(name)` | 切表情（渲染器支持时，如 gltf）；传 `'neutral'` 清除手动层 |
| `pet.setGesture(name\|null)` | 头部小动作：`nod/shake/tilt/lookUp/lookDown/lean`；传 `null` 清除手动层 |
| `pet.voice(lineId)` | 播预录台词（音频 + 口型 + 气泡 + 台词表情） |
| `pet.speak(text)` | 任意文字说话（TTS provider） |
| `pet.stopSpeak()` | 停止说话 |
| `pet.perform(perf)` | 执行表演对象 |
| `pet.voicePack()` | 语音包（Promise） |
| `pet.on(evt, cb)` | 监听 `action`/`state`/`click`/`drag`/`speech`（`{phase:'start'\|'end', text, lineId?}`） |
| `pet.destroy()` | 卸载释放 |

---

## AI / Agent 接入

**标准事件**（`pet.feed` / `bridge.dispatch` 归一化到这些）：
`session.started · session.idle · agent.thinking · agent.thinking.done · tool.started · tool.completed ·
user_input.required · user_input.resolved · task.completed · task.failed`

`agent.thinking` 与 `tool.started` 一样是起止事件驱动、无固定时长——思考多久、工具跑多久由
调用方实际状态决定，driver 不猜测超时。必须显式喂 `agent.thinking.done`（或转到其它状态事件）才会
离开 THINKING，否则会一直停留。

状态机把事件按语义分类、多任务按优先级折叠
（`WAITING_FOR_USER > ERROR > WORKING > THINKING > SUCCESS > IDLE > SLEEPING`），
再经素材包的 `stateActions` 映射到动作。

**三种接入路径**：

```js
// A) 已是标准事件
pet.feed({ type: 'tool.started', tool: 'bash', taskId: 'agent-1' });

// B) 各家原始事件 → 内置/自定义映射自动归一化
pet.bridge.dispatch({ type: 'assistant/chunk' });        // → agent.thinking
pet.bridge.dispatch({ type: 'turn/end', reason: 'error' }); // → task.failed
// 绑一个事件源
pet.bridge.bindEventSource((emit) => {
  const h = (raw) => emit(raw); myAgent.on('event', h);
  return () => myAgent.off('event', h);   // 返回 unsubscribe
});

// C) 意图/情绪表演（不改工作状态）
pet.react('greet');  // 挥手

// D) 让 LLM 决定反应 + 说话
const pet = await createPet({ pet:'blue-whale', ai:{ enabled:true, llm:{ complete: myCompleteFn } } });
await pet.llm.react('用户夸了它很可爱');  // 模型返回 {intent, say}，宠物表演 + 冒泡
```

`complete(prompt) => Promise<string>` 由你实现（走你已有的模型网关/key），库不绑定任何厂商。

---

## 素材包制作（pet.json）

一个素材包 = 一个目录 `pets/<id>/pet.json` + 素材文件。程序不含任何素材硬编码。

**通用字段**：
```jsonc
{
  "id": "my-pet",
  "renderer": "webm",              // 用哪种渲染器
  "meta": { "name": "...", "description": "..." },
  "assetsDir": "assets/",          // 素材文件相对 pet.json 的目录
  "actions": { "idle": "idle.webm", ... },   // 动作 → 资源（格式因渲染器而异）
  "chain": { ... },                // 概率链驱动的池（见下）
  "stateActions": { "IDLE":"idle", "THINKING":"think", ... },  // 状态机驱动的映射
  "intentMap": { "happy":"click-happy", ... }  // AI 意图 → 动作
}
```

**各渲染器的 `actions` 格式**：
- `webm` / `gif`：`{ 动作: "文件名" }`；webm 另需 `geometry:{aspect,feetRatio}`
- `spritesheet`：`sheet`+`grid:{cols,cellW,cellH}`，`actions:{动作:{row,durations:[...]}}`
- `pixel`：`grid:{w,h}`+`palette:{字符:色}`+`frames:{键:[网格行]}`，`actions:{动作:[帧键...]}`
- `gltf`：`model`、`camera`(`full`/`bust`/对象；`full` 按所有动作的包络取景，高宽都装下)、`framePadding`（`full` 取景四周留白比例，默认 0.1）、`frameBox`（手动指定包络盒，跳过加载时约 0.3s 的采样）、`turnDeg`（顶层，`setFacing` 转身角度，默认 70）、`aspect`（舞台宽高比，控制舞台高度）、`voices`；`actions:{动作:"Clip" | {clip, once, yaw, speed, speedScale}}`（`yaw` 为播该动作时的身体朝向，如 `walk-left: -70` / `walk-right: 70`）；
  模型修正开关（默认全关）`scale`、`stripRootMotion` + `rootBone`、`materialFixes`（`"kuro"`），口型 / 眨眼 `blinkMorph`、`visemes`、`mouthMap`，
  腮红材质 `blush.material`，见 `renderers/gltf.js` 头注释
- `svg` / `three`：`colors:{...}`，`actions:{动作:"内置姿势名"}`（模型/姿势内置在渲染器）

**chain 池**：
```jsonc
"chain": {
  "idle": ["idle", "sleep"],
  "actions": ["walk", "stretch"],
  "categories": [{ "id": "玩耍", "weight": 40, "actions": ["dance", "cheer"] }],
  "clicks": ["click-happy", "click-shy"],
  "weights": { "idle": 30, "action": 25 },  // category = 100 - idle - action
  "playMs": { "fidget-1": 43500, "default": 12000 }  // 见下
}
```

`chain.playMs` 决定一个动作播多久后再掷骰，可以是数字、函数 `(action)=>ms`，或按动作的映射
`{ "<action>": ms, "default": ms }`（未命中且无 `default` 时随机 8~20s）。时长较长的 clip（如待机小动作）
应在这里按动作声明。意图 / 表演打断时 pet 会调用 `driver.hold(driver.playMsFor(动作))` 让概率链让路
（让路时长 = 该动作的 `playMs`；表演对象的 `holdMs` 只管表情/手势保持多久），避免刚做完反应就被链条立刻切走；
手动 `play()` / 表演的非走动动作会停下正在进行的水平走动；走到屏幕边缘时会立即触发下一次挑选。
`statemachine` 驱动在 IDLE（委托内部概率链）时同样支持 `hold` / `pickNext` / `playMsFor`，
未配置 `clickAction` 时点击会走概率链的 `clicks` 表演。

现有示范包（`pets/index.json`）：`blue-whale`(webm) · `whale-gif`(gif) ·
`pixel-puff`(pixel) · `chibi-svg`(svg) · `chibi-3d`(three) · `qingxiao`(gltf)。

---

## 表演对象（stateActions / intentMap / chain.clicks）

值可以是动作名字符串，也可以是对象：

```jsonc
{ "action": "idle", "expression": "sad", "gesture": "lookDown", "voice": "error", "say": "…", "holdMs": 3000 }
```

- 状态（stateActions）：进入状态时切表情 / 手势、播语音；离开时恢复。
- 意图（intentMap）/ 点击（clicks）：一次性，表情/手势保持 `holdMs`（默认 3s）后恢复。
- 带 `voice` 的表演：台词没播成（冷却 / 台词不存在 / 无音频）且写了 `say` 时退回 `say` 气泡；没有 `voice` 只有 `say` 直接冒泡（状态 / 点击 / 意图同一规则）。
- 渲染器不支持的部分自动忽略（webm 宠物也能用 voice/say）。

### 表情 / 手势分层（`core/look.js`）

多个来源同时想改表情/手势，各来源只写自己那一层，由纯函数 `resolveLook` 统一解析后下发（结果变化才下发）：

- 表情：说话（talk）> 手动（manual）> 意图（react）> 状态（state）> `neutral`
- 手势：手动 > 意图 > 状态 > 无（说话不碰手势）
- 手动层：`pet.setExpression(name)` / `pet.setGesture(name)` 一直保持，`setExpression('neutral')` / `setGesture(null)` 清除。
- 点击的表情/手势进意图层（带 `holdMs`），不动状态层。
- 说话层只来自语音台词自身的 `expression`（`neutral` 视为未设置），说完约 0.7s 后清除；状态/意图的表情不会升格为说话层。

---

## 语音（voice）

`pet.voice(lineId)` 播预录台词（`pet.json` 的 `voices` 指向语音包 `index.json`），`pet.speak(text)` 走 TTS provider。
两者返回 `Promise<{ played, reason?, interrupted? }>`，`reason` 可能为：
`locked`（音频未解锁）· `error` · `tts-error` · `no-tts` · `no-src` · `empty` · `cooldown` · `unknown-line` · `disabled` · `destroyed`。
同一时刻只说一段，新的打断旧的（被取代的一段不发 `speech:end`）。

### TTS provider

```js
// (text, { lang }) => Promise<audio | { done, cancel? } | null>
createPet({ pet: 'qingxiao', voice: { tts: async (text, { lang }) => fetchMyTts(text, lang) /* -> Blob */ } });
```

- 返回音频（`Blob` / `ArrayBuffer` / TypedArray / URL）：库播放并按音频驱动口型（推荐：云 TTS、克隆音色）。
- 返回 `{ done: Promise, cancel?: () => void }`：provider 自己出声，库按字估算口型直到 `done` 落定；被打断时调 `cancel()`。默认 `browserTts` 即此形式。
- 返回 `null`：无可用 TTS，`{ played:false, reason:'no-tts' }`，不动嘴。

---

## 已知限制

- webm 等不支持口型的宠物：语音与气泡可用，但没有嘴部动作（`capabilities.mouth` 为 false）。
- 浏览器 TTS 的口型是按字估算的，与实际发音只大致同步；要精确口型请注入返回音频的 provider。
- 浏览器自动播放策略：用户首次交互（点击/按键）之前不能出声，此时 `voice()/speak()` 返回 `reason:'locked'`，气泡照常显示。
- gltf 的待机小动作（fidget）clip 很长（十几到四十几秒），记得在 `chain.playMs` 里按动作声明时长，否则会被默认的随机时长提前切走。

---

## Dashboard

`dashboard/index.html` 是素材展示 + 调试台：左侧列出所有素材包，中间实时预览，
右侧可点动作预览、切驱动/渲染器/朝向、模拟 Agent 事件、触发意图表演、看事件日志。

```sh
python3 -m http.server 8799
# 打开 http://localhost:8799/dashboard/index.html
```

---

## 扩展

```js
// 自定义渲染器
import { registerRenderer, RendererBase } from './pet-lib/index.js';
class MyRenderer extends RendererBase { async mount(){} play(a){} destroy(){} }
registerRenderer('my', MyRenderer);

// 自定义驱动
import { registerDriver, DriverBase } from './pet-lib/index.js';
class MyDriver extends DriverBase { start(){ this._emit('idle',{loop:true}); } }
registerDriver('my', MyDriver);
```
