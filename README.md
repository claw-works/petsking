# 🐾 agent-pet

> 一个**渲染无关、驱动可插拔、程序与素材分离**的桌面宠物库。
> 同一套 API，七种渲染载体，两种驱动方式，一键接入 AI / Agent 事件。

给你的网页 / 应用 / Agent 工具挂一只桌宠：它可以自主陪伴（概率动画链），
也可以反映 AI 的工作状态（思考 / 调工具 / 等审批 / 完成）。换宠物只需换一个 `pet.json`。

```js
import { createPet } from './pet-lib/index.js';
const pet = await createPet({ pet: 'blue-whale' });   // 一行，桌宠出现在右下角
```

---

## ✨ 特性

- **四层解耦**：驱动（播什么）/ 渲染（怎么画）/ 素材（画什么）/ AI 接入（外部信号）彼此独立。
- **七种渲染载体**：`webm` 透明视频 · `gif` · `spritesheet` 精灵表 · `pixel` 像素 canvas · `svg` 矢量骨骼 · `three` 3D · `gltf` 3D 角色（骨骼动画 + 表情 + 口型 + 语音）。
- **两种驱动**：`chain` 概率动画链（自主陪伴）· `statemachine` Agent 语义状态机（多任务优先级折叠）。
- **AI / Agent 接入**：把各家 Agent 事件归一化 → 状态；意图/情绪 → 表演；可选接 LLM 决定反应与台词。
- **程序 / 素材分离**：程序在 `pet-lib/`，素材在 `pets/<id>/pet.json + 素材文件`，零硬编码路径。
- **纯 ESM，零构建**：静态服务器托管即可，无需打包工具。

---

## 🚀 快速开始

```sh
git clone git@github.com:claw-works/petsking.git
cd petsking
bun install
cp .env.example .env
# 编辑 .env：JWT_SECRET 填一个随机字符串；AWS_REGION / BEDROCK_MODEL_ID 按你的 AWS 账号调整（只影响陪伴聊天功能）
tools/sync-qingxiao-assets.sh   # 可选：同步清霄 3D 模型与语音（不进 git）
bun run server
# 打开 http://localhost:8787/
```

四个页面：

| 路径 | 说明 |
|------|------|
| `/` | 项目介绍页：技术方案总览，链到各文档 |
| `/dashboard/` | Instance 列表：按渲染方案分组，浏览所有「素材 × 渲染器」组合；webm 宠物卡片上有「互动」入口可以直接聊天 |
| `/playground/?pet=blue-whale` | 调试台：切驱动/渲染器/朝向、调大小/背景、点动作预览、模拟 Agent 事件 |
| `/chat/?pet=blue-whale` | 陪伴聊天：邮箱登录后跟宠物角色打字聊天，回复由 Amazon Bedrock 驱动 |

---

## 📦 集成

```js
// 自主陪伴（概率链）
const pet = await createPet({ pet: 'pixel-puff', renderer: 'pixel', driver: 'chain', size: 240 });

// 接 Agent：反映工作状态
const pet = await createPet({ pet: 'blue-whale', driver: 'statemachine', ai: { enabled: true } });
pet.feed({ type: 'agent.thinking' });                       // 标准事件
pet.bridge.dispatch({ type: 'tool/call', tool: 'edit' });    // 原始事件自动归一化
pet.react('happy');                                          // 意图/情绪表演
pet.say('搞定啦～');                                          // 冒泡说话
```

完整 API、配置项、素材包制作规范见 **[pet-lib/README.md](pet-lib/README.md)**。

> 用 `three` 渲染器时，页面需提供 importmap（见 pet-lib/README）。

---

## 💬 角色培养聊天

`pets/index.json` 里标了 `chat: true` 的宠物（`blue-whale`、`残红(canhong)`、`早雾(zaowu)`、`清霄(qingxiao)`）支持在 `/chat/?pet=<id>` 打字聊天（也可以从 `/dashboard/` 对应卡片的"互动"链接进入），回复由 Amazon Bedrock（Claude）驱动，可通过 tool-use 触发桌宠动画；清霄（gltf）会用语音朗读回复；每个用户的对话历史按 `(用户, 宠物)` 落地 SQLite 持久化，互不可见。

前置条件：

- 已安装 [Bun](https://bun.sh)
- 一个具备 Bedrock 访问权限的 AWS 账号，且已在该账号里启用所选模型（默认用跨区域推理配置 ID `us.anthropic.claude-sonnet-4-5-...`）

只有 `blue-whale` 配了专属人设（`pets/blue-whale/soul.md`）；残红和早雾还没配，聊天时会走一段通用助手兜底文案。

> 登录态 30 天后过期，过期需清浏览器数据重新登录，暂未做应用内自动续期 —— 这是当前 MVP 的已知取舍，不是待修 bug。

设计文档：[character-chat-design.md](docs/superpowers/specs/2026-09-01-character-chat-design.md)、[dashboard-chat-integration-design.md](docs/superpowers/specs/2026-09-02-dashboard-chat-integration-design.md) · 实施计划：[character-chat.md](docs/superpowers/plans/2026-09-01-character-chat.md)、[dashboard-chat-integration.md](docs/superpowers/plans/2026-09-02-dashboard-chat-integration.md)。

---

## 🗂️ 仓库结构

```
pet-lib/        库本体（程序）
  core/         驱动：chain / statemachine
  renderers/    渲染器：webm/gif/spritesheet/pixel/svg/three/gltf
  voice/        语音层：lipsync / TTS provider / 语音包
  ai/           AI 接入：agent-bridge / llm-adapter
  pet.js        DeskPet 主类
  index.js      createPet 公开 API
  README.md     库文档
pets/           素材包（程序/素材分离）
  <id>/pet.json 素材清单（渲染器 + 动作 + chain 池 + stateActions + intentMap）
  index.json    素材包索引
assets/         共享素材（91 个透明 webm）
dashboard/      Instance 列表页
playground/     宠物调试台
server/         角色培养聊天：Bun 服务端（鉴权 + WebSocket 聊天 + Bedrock + SQLite）
chat/           角色培养聊天：前端页面
docs/           渲染方案 / 驱动范式 / webm 素材生产规范（viewer.html 可在线看）
backup/         早期实验页归档
```

---

## 📚 文档

- [渲染方案对比](docs/渲染方案对比.md) — 各渲染载体的取舍
- [三种驱动范式对比](docs/三种驱动范式对比.md) — 概率链 / 状态机 / 物理引擎
- [WebM 宠物素材生产规范](docs/webm宠物素材生产规范.md) — AI 生成视频 + 绿幕收尾帧的完整流程
- [pet-lib 库文档](pet-lib/README.md) — 安装 / 配置项 / 驱动函数 / AI 接入 / 素材包制作 / 扩展

---

## License

MIT
