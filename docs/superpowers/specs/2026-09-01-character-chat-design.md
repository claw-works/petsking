# 角色培养聊天（Character Chat）设计文档

日期：2026-09-01

## 背景 / 目标

在现有 `pet-lib` + `pets/*` 素材体系之上，做一个"陪伴聊天"playground：给宠物角色配一份人设，用户可以跟它文字聊天，聊天过程中角色会用已有的 webm 动作库做出实时反应（比如高兴、害羞、生气）。

技术选型上选"独立 server"路线（而非纯浏览器本地存储）：server 持有 LLM 凭证，避免 key 暴露在前端；同时这套 server 是未来往"全功能助手 / harness"演进的起点——聊天里用到的"工具调用触发动作"机制，后续可以直接扩展成真实工具调用。

MVP 定位：**虚拟陪伴**，只做通、做对一条完整链路（登录→聊天→流式回复→动作联动→历史持久化），不做记忆压缩、不做主动推送、不做多宠物、不做整站视觉翻新。

## 非目标（本次不做，留给后续阶段）

- 记忆/经历提取与摘要（对话历史直接全量拼接，不做压缩）
- 宠物主动发言/推送（WebSocket 双向管道会搭好，但触发逻辑不在本次范围）
- 多宠物同时支持（只做 `pets/blue-whale`）
- 首页、旧 `playground/` 的整站视觉重设计（单独一个 spec，用 frontend-design skill 处理）
- 邮箱验证、找回密码、限流防刷（自用/低风险场景，从简）
- 工具调用扩展到真实工具执行（这次的 `perform_action` 只用于触发宠物动作）

## 技术栈

- Runtime/包管理：Bun（沿用项目现有约定，不引入 Rust 后端——现有 `pet-lib`/`AgentBridge`/`intentMap` 全是 ESM/JS，同语言可直接复用，且 Bedrock 的 JS SDK 对 Converse 流式 + tool use 支持成熟）
- LLM：Amazon Bedrock（Converse Stream API，走 AWS 凭证，不单独存 API key）
- 存储：`bun:sqlite`，通过存储接口抽象，不与 SQLite 强耦合
- 传输：WebSocket（为后续"宠物主动推送"预留双向通道）

## 架构总览

```
浏览器 (chat/ 新 playground 页面)
  ├─ pet-lib 渲染 blue-whale（复用现有 createPet/AgentBridge）
  ├─ WebSocket 客户端：发用户消息 / 收文字流 + 动作事件
  └─ 聊天气泡 UI（现代风格，仅本页面范围）

        │ WebSocket ws://<host>/ws?token=<jwt>
        ▼

Bun server（新目录 server/）
  ├─ HTTP: POST /api/register, POST /api/login，静态文件服务
  ├─ WS handler：鉴权 → 收用户消息 → 读历史 → 拼 prompt(soul.md + 历史 + 时间差) → 调 LLM → 流式转发 + 落库
  ├─ LlmProvider 接口 + BedrockProvider 实现（Converse Stream + tool use）
  ├─ perform_action 工具：enum 从对应 pet.json 的 intentMap 生成
  ├─ ConversationStore 接口 + SqliteConversationStore 实现
  └─ auth 模块：注册/登录、JWT 签发与校验

        │ AWS SDK (Converse Stream + tool use)
        ▼
   Amazon Bedrock（Claude 模型）
```

## 数据流

1. 用户在 chat 页面登录（JWT 存 localStorage），WS 连接携带 `?token=`。
2. 用户发一条消息 → server 校验 JWT → 存一条 `messages` 行（role=user）。
3. server 读该用户+该宠物的历史消息，计算"距上一条消息过去多久"，拼成：`soul.md 内容 + 可用意图列表 + 时间差提示 + 历史消息` 作为 Bedrock Converse 的输入，并声明 `perform_action` 工具。
4. Bedrock 流式返回：文字增量 → 通过 WS 转成 `text_delta` 实时推给前端；期间模型若调用 `perform_action` 工具 → server 立刻推一条 `action` 事件，前端用现有 `AgentBridge.reactTo(intent)` 驱动宠物表演。
5. 流结束 → server 把完整回复存一条 `messages` 行（role=assistant，附带触发过的 action）→ 推 `done` 事件。

## 数据模型（SQLite）

```sql
users (
  id TEXT PRIMARY KEY,        -- uuid
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
)

messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pet_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant'
  content TEXT NOT NULL,
  action TEXT,                 -- 该轮触发的 intent（可为空）
  created_at INTEGER NOT NULL
)
```

`messages` 按 `(user_id, pet_id)` 隔离，即"按用户维度隔离养成信息"的落地方式：不同用户与同一只宠物的对话历史互不可见。每个用户与每只宠物只有一条连续对话（没有"新建对话"概念）。

### 存储抽象

```ts
interface ConversationStore {
  appendMessage(userId: string, petId: string, msg: { role: 'user'|'assistant', content: string, action?: string }): Promise<void>;
  listMessages(userId: string, petId: string, limit?: number): Promise<Message[]>;
  lastMessageAt(userId: string, petId: string): Promise<number | null>;
}
```

MVP 提供 `SqliteConversationStore` 实现；接口本身不依赖 SQLite，后续换 Postgres/其他存储只需新增一个实现。

## 认证

- `POST /api/register` `{email, password}` → 密码用 `Bun.password.hash`（argon2id）→ 建用户 → 返回 JWT
- `POST /api/login` `{email, password}` → `Bun.password.verify` → 返回 JWT
- JWT：HS256，payload `{ sub: userId, exp }`，密钥来自环境变量 `JWT_SECRET`
- 前端把 JWT 存 localStorage；HTTP 请求走 `Authorization: Bearer <token>`；WS 连接走 `/ws?token=<jwt>`（浏览器原生 WebSocket 不能自定义 header）
- 每个受保护路由 / WS upgrade 都校验 JWT 并取出 `userId`；校验失败 WS 直接以自定义 close code 关闭
- 开放自助注册，不做邮箱验证（自用场景，从简；如后续被滥用再加白名单/验证码）

## LLM 集成

```ts
interface LlmProvider {
  streamChat(input: {
    system: string;
    messages: { role: 'user'|'assistant', content: string }[];
    tools: ToolSpec[];
  }): AsyncIterable<
    | { type: 'text_delta'; delta: string }
    | { type: 'tool_call'; name: string; input: any }
    | { type: 'done' }
  >;
}
```

`BedrockProvider` 用 Bedrock Converse Stream API 实现该接口，声明一个 `perform_action` 工具：

```json
{
  "name": "perform_action",
  "description": "触发一个宠物动作/表情反应",
  "input_schema": { "intent": { "enum": ["greet","happy","shy","angry","think","dance","sleep","celebrate", ...] } }
}
```

`enum` 取值来自对应宠物 `pet.json` 的 `intentMap` 键（`blue-whale` 已有：greet/happy/shy/angry/think/dance/sleep/celebrate）。

## 人设（Persona）

- 每个支持聊天的角色目录下放一个 `soul.md`（本次只做 `pets/blue-whale/soul.md`），内容是自由文本人设描述（性格、说话风格、与用户关系等）。
- server 启动时读入并缓存在内存；用作 system prompt 的核心部分。
- system prompt 拼装 = `soul.md 内容` + 一段固定说明（说明可以调用 `perform_action` 工具做动作反应）+ 每轮实时计算的"时间差"提示（比如"距离上次聊天已经过去 3 天"），时间差不入库，只在调用模型前临时拼入。

## 实时协议（WebSocket）

客户端 → 服务端：
```json
{ "type": "user_message", "text": "你好呀" }
```

服务端 → 客户端：
```json
{ "type": "text_delta", "delta": "嗨，" }
{ "type": "action", "intent": "greet" }
{ "type": "done" }
{ "type": "error", "message": "..." }
```

## 目录结构

```
server/
  index.ts                       # Bun.serve：路由 + WS upgrade + 静态文件
  auth.ts                        # 注册/登录、JWT 签发与校验
  db.ts                          # bun:sqlite 初始化 + 建表
  store/
    conversation-store.ts        # ConversationStore 接口
    sqlite-conversation-store.ts # SQLite 实现
  llm/
    provider.ts                  # LlmProvider 接口 + ToolSpec 类型
    bedrock-provider.ts          # Bedrock Converse Stream 实现
  chat-session.ts                # 单次 WS 会话编排：拼 prompt → 调 provider → 转发事件 → 落库

chat/
  index.html                     # 新聊天页面（现代风格 UI，仅此页面范围）
  chat.js                        # WS 客户端 + pet-lib 挂载 + AgentBridge.reactTo
  chat.css

pets/blue-whale/soul.md          # 新增人设文件
```

`playground/` 保持不变，继续作为动作/驱动调试台。

## 错误处理

- JWT 校验失败：HTTP 401 / WS 关闭（自定义 close code）
- Bedrock 调用失败或流中断：WS 推 `{type:'error', message}`，前端提示"消息未能送达"，不写入 assistant 消息
- `perform_action` 传入非法 intent：server 端过滤，忽略并记录日志，不影响文字流

## 验证方式

- 手动跑通：注册 → 登录 → 连 WS → 发消息 → 观察文字流式显示 + 宠物动作联动 → 刷新页面后历史仍存在 → 用另一账号登录同一宠物看不到对方历史
- 单元测试覆盖：JWT 签发/校验、`SqliteConversationStore` 的增删查、`perform_action` intent 白名单过滤逻辑
