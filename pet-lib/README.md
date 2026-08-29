# pet-lib — 可集成的桌面宠物库

一个**渲染无关、驱动可插拔、程序与素材分离**的桌宠库。同一套 API 可以用
webm / gif / 精灵表 / 像素 canvas / SVG 骨骼 / Three.js 3D 六种渲染方式，
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
渲染 Renderer 决定「怎么画」       webm/gif/spritesheet/pixel/svg/three
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

> 用到 `three` 渲染器时，页面需提供 importmap：
> ```html
> <script type="importmap">
> { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }
> </script>
> ```

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
| `renderer` | string | 素材包声明 | `webm`/`gif`/`spritesheet`/`pixel`/`svg`/`three` |
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
| `pet.on(evt, cb)` | 监听 `action`/`state`/`click`/`drag` |
| `pet.destroy()` | 卸载释放 |

---

## AI / Agent 接入

**标准事件**（`pet.feed` / `bridge.dispatch` 归一化到这些）：
`session.started · session.idle · agent.thinking · tool.started · tool.completed ·
user_input.required · user_input.resolved · task.completed · task.failed`

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
- `svg` / `three`：`colors:{...}`，`actions:{动作:"内置姿势名"}`（模型/姿势内置在渲染器）

**chain 池**：
```jsonc
"chain": {
  "idle": ["idle", "sleep"],
  "actions": ["walk", "stretch"],
  "categories": [{ "id": "玩耍", "weight": 40, "actions": ["dance", "cheer"] }],
  "clicks": ["click-happy", "click-shy"],
  "weights": { "idle": 30, "action": 25 }   // category = 100 - idle - action
}
```

现有示范包（`pets/index.json`）：`blue-whale`(webm) · `whale-gif`(gif) ·
`pixel-puff`(pixel) · `chibi-svg`(svg) · `chibi-3d`(three)。

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
