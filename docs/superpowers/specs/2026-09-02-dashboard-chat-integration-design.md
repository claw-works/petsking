# Dashboard 互动入口 + 多宠物聊天（webm 范围）设计文档

日期：2026-09-02

## 背景 / 目标

上一轮（2026-09-01）交付的"角色培养聊天"是一个独立的 `chat/index.html`：裸的登录表单 + 硬编码只认 `blue-whale`，视觉风格和站点其他页面（首页/dashboard/playground）完全不一致，用户反馈"太粗糙"。

这次的目标：把聊天功能真正接入现有的宠物展示系统，而不是一个孤立页面。具体是——

1. 整站合并成一套服务（Bun server），不再是"静态站点用 python http.server、聊天用 bun server"两套并行。
2. `dashboard/` 每张 instance 卡片增加两个动作入口：**展示皮肤**（原有，进 playground）、**互动**（新增，进聊天）。
3. "互动"入口范围：**只覆盖 webm 渲染器的宠物**（blue-whale / 残红 canhong / 早雾 zaowu）。其他渲染器（像素/SVG/3D）留给以后。
4. 三个 webm 宠物里目前只有 blue-whale 配了 `soul.md` 人设；没配人设的（残红、早雾）聊天时用一段通用兜底人设，不因为"没有专属人设"而不可用。
5. 聊天页面本身做**小改**：加导航栏（回首页/宠物库）+ 配色对齐站点深色主题（`--bg`/`--accent`/`--card` 等变量），不重新设计布局结构。

## 非目标（本次不做）

- 非 webm 渲染器（像素/SVG/3D/GIF/精灵表）的宠物加入聊天——前端渲染器目前是硬编码 `renderer:'webm'`，做成通用识别是下一步的事。
- 聊天页面布局重新设计（登录区/聊天区排列方式不变，只换皮）。
- 记忆提取、宠物主动发言、多角色同时聊天——这些在上一轮 spec 里已经排除，本次不重新讨论。
- 首页 `index.html`、`playground/` 的内容/交互改动——只涉及"能否被同一个 server 访问到"，不改它们本身的功能。

## 架构变更

### 服务合并

`server/index.js` 的 `STATIC_ALLOWLIST` 从 `['chat/', 'pets/', 'pet-lib/']` 扩到覆盖整站需要展示的静态资源：

```js
const STATIC_ALLOWLIST = ['chat/', 'pets/', 'pet-lib/', 'dashboard/', 'playground/', 'docs/', 'assets/', 'tools/', 'index.html'];
```

`serveStatic` 的 `/` → `chat/index.html` 兜底改成 `/` → `index.html`（站点首页）。

README 里"先起 `python3 -m http.server` 看静态站，再起 `bun run server` 聊天"的两段式说明，合并成一句 `bun run server` 起全部（首页/宠物库/playground/聊天都在同一个端口下）。

### 多宠物聊天后端

之前 `server/index.js` 在启动时只读了一份 `blue-whale` 的 `soul.md` + `pet.json.intentMap`，聊天时 `PET_ID` 是模块级常量。改成：

1. 启动时读 `pets/index.json`，筛出 `renderers` 包含 `webm` 的宠物 id 列表（目前是 `blue-whale`、`canhong`、`zaowu`）。
2. 对这个列表里的每个 id：读它的 `pet.json` 拿 `intentMap`；尝试读 `pets/<id>/soul.md`，读到就用，读不到就用下面的通用兜底人设文本。
3. 把这些按 id 组织成一个内存里的小注册表（`Map<petId, {soul, intents}>`），供 WS 会话按需查。

**通用兜底人设**（没有 `soul.md` 的宠物用这段）：

```
你是桌面陪伴宠物，用户还没有为你写专属人设。用简短、友好、略带活泼的语气正常聊天即可，不用扮演任何特定角色设定。
你可以在合适的时候调用 perform_action 触发一个动作反应，但不要每句话都调用。
台词尽量简短（一两句话）。
```

（这段会被 `buildSystemPrompt` 当作 `soul` 参数使用，和已有的 `pets/blue-whale/soul.md` 走同一条拼装逻辑，不需要改 `server/prompt.js`。）

### WS 按连接选宠物

- `/ws` upgrade 时除了现有的 `?token=`，新增必需参数 `?pet=<id>`。
- 服务端校验 `pet` 是否在上面的注册表里；不在（比如非 webm 宠物，或者压根不存在的 id）就拒绝 upgrade（400），不再是校验 token 之后无脑放行。
- 校验通过后，把 `petId` 也存进 `server.upgrade(req, { data: { userId, petId } })`。
- WS 消息处理器里，`runChatTurn` 调用时的 `petId`、`soul`、`intents` 都从 `ws.data.petId` 查注册表拿，不再引用模块级常量。

### 数据层

不需要改 schema——`messages` 表和 `SqliteConversationStore` 本来就是按 `(user_id, pet_id)` 存取的，之前只是因为 server 端硬编码成一个 pet 才看起来像单宠物。同一个用户和不同宠物的对话历史天然分开，这次直接受益。

## 前端变更

### dashboard 卡片

`dashboard/dashboard.js` 目前每张卡片是整体一个 `<a>`。改成卡片本体不是链接，卡片底部放两个动作链接：

- **🎭 展示皮肤 →**：所有 instance 都有，链接和逻辑不变（`../playground/?pet=<id>&renderer=<r>`）。
- **💬 互动 →**：只在 `pack.renderers.includes('webm')` 时渲染，链接到 `../chat/index.html?pet=<id>`。

### chat 页面

- `chat/chat.js` 从 `location.search` 读 `?pet=`（缺省时默认 `blue-whale`，保持向后兼容），挂宠物时用这个 id（`createPet({ pet: petId, ... })`），WS 连接 URL 带上 `&pet=<petId>`。
- 页面标题/顶部文案不再硬编码"残红"：连接前先 fetch 一次 `../pets/<petId>/pet.json`，用 `meta.name` 填充标题（比如"残红 · 陪伴聊天"变成动态的"`<meta.name>` · 陪伴聊天"）。
- `chat/index.html` 加一个导航栏，和首页 `index.html` 的 nav 结构/文案一致（🐾 Pet's King · 首页 · 宠物库），放在 `#auth-panel`/`#chat-panel` 外层最上方。
- `chat/chat.css` 的配色变量对齐 `index.html` 里的 `:root` 变量（`--bg`、`--card`、`--accent` 等），布局结构不变，只换色值和加 nav 样式。

## 文件改动清单

```
server/index.js         # STATIC_ALLOWLIST 扩展、/ 指向 index.html、pet 注册表 + 通用兜底人设、/ws 按 pet 校验
README.md               # 起服务方式说明合并成一条 bun run server
dashboard/dashboard.js   # 卡片改双链接结构，webm 宠物加"互动"
chat/index.html          # 加导航栏
chat/chat.css            # 配色对齐站点主题
chat/chat.js             # 读 ?pet= 参数、动态标题、WS 带 pet 参数
```

## 验证方式

- 手动跑通：`bun run server` 后依次访问 `/`（首页）→ `/dashboard/`（能看到三张 webm 卡片各有"展示皮肤"+"互动"两个入口，非 webm 卡片只有"展示皮肤"）→ 点"展示皮肤"确认还是原来的 playground → 点"互动"进聊天，标题显示对应宠物名。
- 分别用 blue-whale（有人设）、残红或早雾（无人设，走兜底）登录同一账号聊天，确认残红/早雾能正常回复（走通用助手兜底），且历史互相隔离（同一用户和不同宠物的对话不串）。
- 单元测试：`server/index.js` 目前无自动化测试（人工验证过的集成入口），本次改动继续沿用这个模式，不新增测试文件；但如果多宠物注册表逻辑（webm 筛选 + soul.md 读取 + 兜底）值得拆成一个纯函数，可以考虑加测试——留给写实施计划时判断。
