# 🐾 agent-pet

> 一个**渲染无关、驱动可插拔、程序与素材分离**的桌面宠物库。
> 同一套 API，六种渲染载体，两种驱动方式，一键接入 AI / Agent 事件。

给你的网页 / 应用 / Agent 工具挂一只桌宠：它可以自主陪伴（概率动画链），
也可以反映 AI 的工作状态（思考 / 调工具 / 等审批 / 完成）。换宠物只需换一个 `pet.json`。

```js
import { createPet } from './pet-lib/index.js';
const pet = await createPet({ pet: 'blue-whale' });   // 一行，桌宠出现在右下角
```

---

## ✨ 特性

- **四层解耦**：驱动（播什么）/ 渲染（怎么画）/ 素材（画什么）/ AI 接入（外部信号）彼此独立。
- **六种渲染载体**：`webm` 透明视频 · `gif` · `spritesheet` 精灵表 · `pixel` 像素 canvas · `svg` 矢量骨骼 · `three` 3D。
- **两种驱动**：`chain` 概率动画链（自主陪伴）· `statemachine` Agent 语义状态机（多任务优先级折叠）。
- **AI / Agent 接入**：把各家 Agent 事件归一化 → 状态；意图/情绪 → 表演；可选接 LLM 决定反应与台词。
- **程序 / 素材分离**：程序在 `pet-lib/`，素材在 `pets/<id>/pet.json + 素材文件`，零硬编码路径。
- **纯 ESM，零构建**：静态服务器托管即可，无需打包工具。

---

## 🚀 快速开始

```sh
git clone git@github.com:claw-works/petsking.git
cd petsking
python3 -m http.server 8799
# 打开 http://localhost:8799/
```

三个页面：

| 路径 | 说明 |
|------|------|
| `/` | 项目介绍页：技术方案总览，链到各文档 |
| `/dashboard/` | Instance 列表：按渲染方案分组，浏览所有「素材 × 渲染器」组合 |
| `/playground/?pet=blue-whale` | 调试台：切驱动/渲染器/朝向、调大小/背景、点动作预览、模拟 Agent 事件 |

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

## 🗂️ 仓库结构

```
pet-lib/        库本体（程序）
  core/         驱动：chain / statemachine
  renderers/    渲染器：webm/gif/spritesheet/pixel/svg/three
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
docs/           渲染方案 / 驱动范式 / webm 素材生产规范（viewer.html 可在线看）
backup/         早期实验页归档
```

---

## 📚 文档

- [渲染方案对比](docs/渲染方案对比.md) — 六种渲染载体的取舍
- [三种驱动范式对比](docs/三种驱动范式对比.md) — 概率链 / 状态机 / 物理引擎
- [WebM 宠物素材生产规范](docs/webm宠物素材生产规范.md) — AI 生成视频 + 绿幕收尾帧的完整流程
- [pet-lib 库文档](pet-lib/README.md) — 安装 / 配置项 / 驱动函数 / AI 接入 / 素材包制作 / 扩展

---

## License

MIT
