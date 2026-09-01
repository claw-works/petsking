# 角色培养聊天（Character Chat）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `pets/blue-whale` 加一个基于 Bun server 的陪伴聊天 playground——邮箱/密码登录、WebSocket 流式聊天、Bedrock 驱动的回复 + 工具调用触发宠物动作、按用户隔离的对话历史持久化。

**Architecture:** 纯 ESM JS（不引入 TS/构建步骤，沿用项目现有约定）。`server/` 下按职责拆小模块（db / 用户 / JWT / 会话存储 / prompt 拼装 / LLM provider / 会话编排），`server/index.js` 用 `Bun.serve` 把它们粘起来，同时把整个仓库根目录当静态站点 serve 出去（新老 playground 都能直接访问）。`chat/` 是新的前端页面，复用现有 `pet-lib` 渲染宠物。

**Tech Stack:** Bun（runtime + `bun:sqlite` + `bun:test` + `Bun.password`）、`@aws-sdk/client-bedrock-runtime`（Bedrock Converse Stream + tool use）、`jose`（JWT 签发/校验）、原生 WebSocket（浏览器端）。

参考设计文档：`docs/superpowers/specs/2026-09-01-character-chat-design.md`

---

## File Structure

```
package.json                              # 新增：server 依赖声明
.env.example                              # 新增：环境变量样例
.gitignore                                # 修改：忽略 .env 和 data/

server/
  db.js                                    # bun:sqlite 打开 + 建表（users, messages）
  db.test.js
  auth.js                                  # 纯函数：密码哈希 + JWT 签发/校验
  auth.test.js
  user-store.js                            # users 表的 CRUD（create/findByEmail）
  user-store.test.js
  auth-flow.js                             # registerUser/loginUser 编排（组合 user-store + auth）
  auth-flow.test.js
  prompt.js                                # 纯函数：system prompt 拼装 + 时间差文案
  prompt.test.js
  store/
    sqlite-conversation-store.js           # messages 表的 CRUD，实现 ConversationStore 契约
    sqlite-conversation-store.test.js
  llm/
    provider.js                            # LlmProvider 契约（JSDoc typedef，仅文档）
    intent-tool.js                         # 纯函数：intent 列表 → perform_action 工具 schema
    intent-tool.test.js
    bedrock-provider.js                    # BedrockProvider：Converse Stream + tool use 实现（需真实 AWS 凭证才能跑通，见 Task 10）
  chat-session.js                          # runChatTurn：编排 store + provider + prompt，产出 WS 事件
  chat-session.test.js
  index.js                                 # Bun.serve：静态站点 + /api/register /api/login + /ws

pets/blue-whale/soul.md                    # 新增：人设文件

chat/
  index.html                               # 新增：登录/注册 + 聊天页面
  chat.css
  chat.js                                  # WS 客户端 + pet-lib 挂载 + 消息渲染
```

---

### Task 1: 项目初始化（package.json + 依赖 + .env）

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "petsking",
  "private": true,
  "type": "module",
  "scripts": {
    "server": "bun run server/index.js",
    "test": "bun test server"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `bun add @aws-sdk/client-bedrock-runtime jose`
Expected: 命令成功退出，`package.json` 的 `dependencies` 里出现这两个包，生成 `bun.lock` 和 `node_modules/`。

- [ ] **Step 3: 写 .env.example**

```
PORT=8787
JWT_SECRET=change-me-to-a-long-random-string
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
DB_PATH=./data/petsking.sqlite
```

- [ ] **Step 4: 更新 .gitignore**

在文件末尾追加：

```
.env
data/
```

- [ ] **Step 5: Commit**

```bash
git add package.json .env.example .gitignore bun.lock
git commit -m "chore: 初始化 server 依赖（bedrock runtime + jose）"
```

---

### Task 2: DB 模块

**Files:**
- Create: `server/db.js`
- Test: `server/db.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/db.test.js
import { test, expect } from 'bun:test';
import { openDb } from './db.js';

test('openDb creates the users table', () => {
  const db = openDb(':memory:');
  db.query(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`
  ).run('u1', 'a@example.com', 'hash', Date.now());
  const row = db.query(`SELECT * FROM users WHERE id = ?`).get('u1');
  expect(row.email).toBe('a@example.com');
});

test('openDb creates the messages table', () => {
  const db = openDb(':memory:');
  db.query(
    `INSERT INTO messages (id, user_id, pet_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('m1', 'u1', 'blue-whale', 'user', '你好', null, Date.now());
  const row = db.query(`SELECT * FROM messages WHERE id = ?`).get('m1');
  expect(row.content).toBe('你好');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/db.test.js`
Expected: FAIL，报错 `Cannot find module './db.js'` 或等价的模块解析错误。

- [ ] **Step 3: 实现 db.js**

```js
// server/db.js — 打开/初始化 SQLite（users + messages 表）
import { Database } from 'bun:sqlite';

export function openDb(path) {
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    pet_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    action TEXT,
    created_at INTEGER NOT NULL
  )`);
  return db;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/db.test.js`
Expected: PASS，2 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/db.test.js
git commit -m "feat(server): 加 SQLite db 初始化模块"
```

---

### Task 3: 密码哈希 + JWT（纯函数）

**Files:**
- Create: `server/auth.js`
- Test: `server/auth.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/auth.test.js
import { test, expect } from 'bun:test';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';

test('hashPassword + verifyPassword roundtrip', async () => {
  const hash = await hashPassword('s3cret');
  expect(await verifyPassword('s3cret', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
});

test('signToken + verifyToken roundtrip', async () => {
  const token = await signToken('user-123', 'test-secret');
  expect(await verifyToken(token, 'test-secret')).toBe('user-123');
});

test('verifyToken rejects a token signed with a different secret', async () => {
  const token = await signToken('user-123', 'test-secret');
  await expect(verifyToken(token, 'wrong-secret')).rejects.toThrow();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/auth.test.js`
Expected: FAIL，`Cannot find module './auth.js'`。

- [ ] **Step 3: 实现 auth.js**

```js
// server/auth.js — 密码哈希 + JWT 签发/校验（纯函数，不接触数据库）
import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

export async function hashPassword(password) {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

export async function verifyPassword(password, hash) {
  return Bun.password.verify(password, hash);
}

export async function signToken(userId, secret) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(encoder.encode(secret));
}

export async function verifyToken(token, secret) {
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return payload.sub;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/auth.test.js`
Expected: PASS，3 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/auth.js server/auth.test.js
git commit -m "feat(server): 加密码哈希与 JWT 签发/校验"
```

---

### Task 4: 用户存储

**Files:**
- Create: `server/user-store.js`
- Test: `server/user-store.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/user-store.test.js
import { test, expect } from 'bun:test';
import { openDb } from './db.js';
import { createUserStore } from './user-store.js';

test('create + findByEmail roundtrip', () => {
  const users = createUserStore(openDb(':memory:'));
  const created = users.create('a@example.com', 'hashed');
  const found = users.findByEmail('a@example.com');
  expect(found.id).toBe(created.id);
  expect(found.email).toBe('a@example.com');
});

test('findByEmail returns undefined for unknown email', () => {
  const users = createUserStore(openDb(':memory:'));
  expect(users.findByEmail('nobody@example.com')).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/user-store.test.js`
Expected: FAIL，`Cannot find module './user-store.js'`。

- [ ] **Step 3: 实现 user-store.js**

```js
// server/user-store.js — users 表的 CRUD
import { randomUUID } from 'node:crypto';

export function createUserStore(db) {
  return {
    findByEmail(email) {
      return db.query(`SELECT * FROM users WHERE email = ?`).get(email);
    },
    create(email, passwordHash) {
      const id = randomUUID();
      db.query(
        `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`
      ).run(id, email, passwordHash, Date.now());
      return { id, email };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/user-store.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/user-store.js server/user-store.test.js
git commit -m "feat(server): 加用户存储模块"
```

---

### Task 5: 注册/登录编排

**Files:**
- Create: `server/auth-flow.js`
- Test: `server/auth-flow.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/auth-flow.test.js
import { test, expect } from 'bun:test';
import { openDb } from './db.js';
import { createUserStore } from './user-store.js';
import { registerUser, loginUser, AuthError } from './auth-flow.js';

test('registerUser creates a user and returns a token', async () => {
  const users = createUserStore(openDb(':memory:'));
  const { token } = await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  expect(typeof token).toBe('string');
  expect(users.findByEmail('a@example.com')).toBeTruthy();
});

test('registerUser rejects a duplicate email', async () => {
  const users = createUserStore(openDb(':memory:'));
  await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  await expect(
    registerUser({ email: 'a@example.com', password: 'other' }, users, 'secret')
  ).rejects.toBeInstanceOf(AuthError);
});

test('registerUser rejects missing email or password', async () => {
  const users = createUserStore(openDb(':memory:'));
  await expect(registerUser({ email: '', password: '' }, users, 'secret')).rejects.toBeInstanceOf(AuthError);
});

test('loginUser returns a token for correct credentials', async () => {
  const users = createUserStore(openDb(':memory:'));
  await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  const { token } = await loginUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  expect(typeof token).toBe('string');
});

test('loginUser rejects wrong password or unknown email', async () => {
  const users = createUserStore(openDb(':memory:'));
  await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  await expect(loginUser({ email: 'a@example.com', password: 'wrong' }, users, 'secret')).rejects.toBeInstanceOf(AuthError);
  await expect(loginUser({ email: 'nobody@example.com', password: 'x' }, users, 'secret')).rejects.toBeInstanceOf(AuthError);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/auth-flow.test.js`
Expected: FAIL，`Cannot find module './auth-flow.js'`。

- [ ] **Step 3: 实现 auth-flow.js**

```js
// server/auth-flow.js — 注册/登录编排（组合 user-store + auth）
import { hashPassword, verifyPassword, signToken } from './auth.js';

export class AuthError extends Error {}

export async function registerUser({ email, password }, userStore, secret) {
  if (!email || !password) throw new AuthError('email and password required');
  if (userStore.findByEmail(email)) throw new AuthError('email already registered');
  const passwordHash = await hashPassword(password);
  const user = userStore.create(email, passwordHash);
  const token = await signToken(user.id, secret);
  return { token };
}

export async function loginUser({ email, password }, userStore, secret) {
  const user = userStore.findByEmail(email);
  if (!user) throw new AuthError('invalid credentials');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AuthError('invalid credentials');
  const token = await signToken(user.id, secret);
  return { token };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/auth-flow.test.js`
Expected: PASS，5 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/auth-flow.js server/auth-flow.test.js
git commit -m "feat(server): 加注册/登录编排"
```

---

### Task 6: 对话存储（ConversationStore）

**Files:**
- Create: `server/store/sqlite-conversation-store.js`
- Test: `server/store/sqlite-conversation-store.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/store/sqlite-conversation-store.test.js
import { test, expect } from 'bun:test';
import { openDb } from '../db.js';
import { SqliteConversationStore } from './sqlite-conversation-store.js';

test('appendMessage + listMessages roundtrip ordered by time', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));
  store.appendMessage('u1', 'blue-whale', { role: 'user', content: '你好' });
  store.appendMessage('u1', 'blue-whale', { role: 'assistant', content: '嗨呀', action: 'greet' });

  const msgs = store.listMessages('u1', 'blue-whale');
  expect(msgs).toHaveLength(2);
  expect(msgs[0]).toMatchObject({ role: 'user', content: '你好' });
  expect(msgs[1]).toMatchObject({ role: 'assistant', content: '嗨呀', action: 'greet' });
});

test('messages are isolated per user', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));
  store.appendMessage('u1', 'blue-whale', { role: 'user', content: '我是u1' });
  store.appendMessage('u2', 'blue-whale', { role: 'user', content: '我是u2' });

  expect(store.listMessages('u1', 'blue-whale')).toHaveLength(1);
  expect(store.listMessages('u2', 'blue-whale')).toHaveLength(1);
});

test('lastMessageAt returns null with no history, else the latest timestamp', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));
  expect(store.lastMessageAt('u1', 'blue-whale')).toBeNull();
  store.appendMessage('u1', 'blue-whale', { role: 'user', content: '嗨' });
  expect(typeof store.lastMessageAt('u1', 'blue-whale')).toBe('number');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/store/sqlite-conversation-store.test.js`
Expected: FAIL，`Cannot find module './sqlite-conversation-store.js'`。

- [ ] **Step 3: 实现 sqlite-conversation-store.js**

```js
// server/store/sqlite-conversation-store.js — messages 表的 CRUD
import { randomUUID } from 'node:crypto';

export class SqliteConversationStore {
  constructor(db) {
    this.db = db;
  }

  appendMessage(userId, petId, { role, content, action = null }) {
    this.db
      .query(
        `INSERT INTO messages (id, user_id, pet_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), userId, petId, role, content, action, Date.now());
  }

  listMessages(userId, petId, limit = 50) {
    return this.db
      .query(
        `SELECT role, content, action, created_at FROM messages WHERE user_id = ? AND pet_id = ? ORDER BY created_at ASC LIMIT ?`
      )
      .all(userId, petId, limit);
  }

  lastMessageAt(userId, petId) {
    const row = this.db
      .query(`SELECT MAX(created_at) as ts FROM messages WHERE user_id = ? AND pet_id = ?`)
      .get(userId, petId);
    return row && row.ts != null ? row.ts : null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/store/sqlite-conversation-store.test.js`
Expected: PASS，3 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/store/sqlite-conversation-store.js server/store/sqlite-conversation-store.test.js
git commit -m "feat(server): 加 SQLite 对话存储"
```

---

### Task 7: System Prompt 拼装（人设 + 时间差）

**Files:**
- Create: `server/prompt.js`
- Test: `server/prompt.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/prompt.test.js
import { test, expect } from 'bun:test';
import { formatElapsed, buildSystemPrompt } from './prompt.js';

test('formatElapsed returns null for gaps under 2 minutes', () => {
  expect(formatElapsed(60 * 1000)).toBeNull();
});

test('formatElapsed formats days/hours/minutes', () => {
  expect(formatElapsed(3 * 24 * 60 * 60 * 1000)).toBe('距离上次聊天已经过去 3 天');
  expect(formatElapsed(5 * 60 * 60 * 1000)).toBe('距离上次聊天已经过去 5 小时');
  expect(formatElapsed(10 * 60 * 1000)).toBe('距离上次聊天已经过去 10 分钟');
});

test('buildSystemPrompt includes soul text and intent list, skips gap note without prior message', () => {
  const prompt = buildSystemPrompt({ soul: '你是一只猫', intents: ['happy', 'sad'], lastMessageAt: null });
  expect(prompt).toContain('你是一只猫');
  expect(prompt).toContain('happy / sad');
  expect(prompt).not.toContain('距离上次聊天');
});

test('buildSystemPrompt adds an elapsed-time note when there is a prior message', () => {
  const now = Date.now();
  const prompt = buildSystemPrompt({ soul: '人设', intents: ['happy'], lastMessageAt: now - 2 * 60 * 60 * 1000, now });
  expect(prompt).toContain('距离上次聊天已经过去 2 小时');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/prompt.test.js`
Expected: FAIL，`Cannot find module './prompt.js'`。

- [ ] **Step 3: 实现 prompt.js**

```js
// server/prompt.js — system prompt 拼装：人设 + 可用意图 + 时间差提示
export function formatElapsed(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 2) return null;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `距离上次聊天已经过去 ${days} 天`;
  if (hours >= 1) return `距离上次聊天已经过去 ${hours} 小时`;
  return `距离上次聊天已经过去 ${minutes} 分钟`;
}

export function buildSystemPrompt({ soul, intents, lastMessageAt, now = Date.now() }) {
  const parts = [soul.trim()];
  parts.push(
    `你可以在合适的时候调用 perform_action 工具触发一个动作反应，intent 从这些里选：${intents.join(' / ')}。不要每句话都调用，只在情绪明显变化时用。`
  );
  if (lastMessageAt != null) {
    const gap = formatElapsed(now - lastMessageAt);
    if (gap) parts.push(gap + '，用户刚刚回来找你说话。');
  }
  return parts.join('\n\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/prompt.test.js`
Expected: PASS，4 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/prompt.js server/prompt.test.js
git commit -m "feat(server): 加 system prompt 拼装（人设+时间差感知）"
```

---

### Task 8: perform_action 工具 schema

**Files:**
- Create: `server/llm/intent-tool.js`
- Test: `server/llm/intent-tool.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/llm/intent-tool.test.js
import { test, expect } from 'bun:test';
import { buildPerformActionTool } from './intent-tool.js';

test('buildPerformActionTool builds a Bedrock toolSpec with an intent enum', () => {
  const tool = buildPerformActionTool(['greet', 'happy', 'sad']);
  expect(tool.toolSpec.name).toBe('perform_action');
  expect(tool.toolSpec.inputSchema.json.properties.intent.enum).toEqual(['greet', 'happy', 'sad']);
  expect(tool.toolSpec.inputSchema.json.required).toEqual(['intent']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/llm/intent-tool.test.js`
Expected: FAIL，`Cannot find module './intent-tool.js'`。

- [ ] **Step 3: 实现 intent-tool.js**

```js
// server/llm/intent-tool.js — 把宠物的 intent 列表包成 Bedrock 的 perform_action 工具 schema
export function buildPerformActionTool(intents) {
  return {
    toolSpec: {
      name: 'perform_action',
      description: '触发一个宠物动作/表情反应',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            intent: { type: 'string', enum: intents },
          },
          required: ['intent'],
        },
      },
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/llm/intent-tool.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/llm/intent-tool.js server/llm/intent-tool.test.js
git commit -m "feat(server): 加 perform_action 工具 schema 构造"
```

---

### Task 9: LlmProvider 契约文档

**Files:**
- Create: `server/llm/provider.js`

这个文件只放 JSDoc 类型说明（"接口"在 JS 里就是文档化契约），没有可执行逻辑，不需要测试。

- [ ] **Step 1: 写 provider.js**

```js
// server/llm/provider.js — LlmProvider 契约（文档用，不含实现）
//
// 任何 LLM provider 需要实现：
//
// streamChat({ system: string, messages: {role:'user'|'assistant', content:string}[], intents: string[] })
//   => AsyncIterable<
//        { type: 'text_delta', delta: string }
//        | { type: 'tool_call', name: string, input: any }
//        | { type: 'done' }
//      >
//
// 换 provider（比如换模型厂商）只需要新写一个实现这个契约的 class，
// chat-session.js 不需要改。

/** @typedef {{ role: 'user'|'assistant', content: string }} ChatMessage */
/** @typedef {{ type: 'text_delta', delta: string } | { type: 'tool_call', name: string, input: any } | { type: 'done' }} ChatStreamEvent */
```

- [ ] **Step 2: Commit**

```bash
git add server/llm/provider.js
git commit -m "docs(server): 记录 LlmProvider 契约"
```

---

### Task 10: 会话编排（runChatTurn）

这是整条链路里最重要的编排逻辑：拿到用户一句话 → 存库 → 算时间差 → 拼 prompt → 调 provider → 把流式事件转发出去 → 把完整回复存库。用假的 store/provider 做依赖注入，完全不需要真实数据库或真实 Bedrock 调用就能测完整逻辑（包括容易出 bug 的"时间差要用上一条消息的时间，不能用刚插入的这条"的顺序问题）。

**Files:**
- Create: `server/chat-session.js`
- Test: `server/chat-session.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/chat-session.test.js
import { test, expect } from 'bun:test';
import { runChatTurn } from './chat-session.js';

function createFakeStore(seed = []) {
  const messages = [...seed];
  return {
    appendMessage(userId, petId, msg) {
      messages.push({ userId, petId, ...msg, created_at: Date.now() });
    },
    listMessages(userId, petId) {
      return messages
        .filter((m) => m.userId === userId && m.petId === petId)
        .map(({ role, content, action }) => ({ role, content, action }));
    },
    lastMessageAt(userId, petId) {
      const own = messages.filter((m) => m.userId === userId && m.petId === petId);
      return own.length ? own[own.length - 1].created_at : null;
    },
    _all: messages,
  };
}

function createFakeProvider(events) {
  return {
    calls: [],
    async *streamChat(input) {
      this.calls.push(input);
      for (const e of events) yield e;
    },
  };
}

test('runChatTurn streams text deltas and persists the full assistant reply', async () => {
  const store = createFakeStore();
  const provider = createFakeProvider([
    { type: 'text_delta', delta: '你好' },
    { type: 'text_delta', delta: '呀' },
    { type: 'done' },
  ]);

  const out = [];
  for await (const ev of runChatTurn({
    userId: 'u1',
    petId: 'blue-whale',
    text: '嗨',
    store,
    provider,
    soul: '你是一只友好的宠物。',
    intents: ['greet', 'happy'],
  })) out.push(ev);

  expect(out).toEqual([
    { type: 'text_delta', delta: '你好' },
    { type: 'text_delta', delta: '呀' },
    { type: 'done' },
  ]);
  expect(store._all).toHaveLength(2);
  expect(store._all[0]).toMatchObject({ role: 'user', content: '嗨' });
  expect(store._all[1]).toMatchObject({ role: 'assistant', content: '你好呀', action: null });
});

test('runChatTurn emits an action event for a valid perform_action call and filters invalid intents', async () => {
  const store = createFakeStore();
  const provider = createFakeProvider([
    { type: 'tool_call', name: 'perform_action', input: { intent: 'happy' } },
    { type: 'tool_call', name: 'perform_action', input: { intent: 'not-a-real-intent' } },
    { type: 'text_delta', delta: '嗯嗯' },
    { type: 'done' },
  ]);

  const out = [];
  for await (const ev of runChatTurn({
    userId: 'u1',
    petId: 'blue-whale',
    text: '你好呀',
    store,
    provider,
    soul: '人设',
    intents: ['greet', 'happy'],
  })) out.push(ev);

  expect(out).toEqual([
    { type: 'action', intent: 'happy' },
    { type: 'text_delta', delta: '嗯嗯' },
    { type: 'done' },
  ]);
  expect(store._all[1]).toMatchObject({ action: 'happy' });
});

test('runChatTurn tells the model how long it has been since the previous message', async () => {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const store = createFakeStore([
    { userId: 'u1', petId: 'blue-whale', role: 'assistant', content: '之前聊过', action: null, created_at: threeDaysAgo },
  ]);
  const provider = createFakeProvider([{ type: 'text_delta', delta: '好久不见' }, { type: 'done' }]);

  const out = [];
  for await (const ev of runChatTurn({
    userId: 'u1',
    petId: 'blue-whale',
    text: '在吗',
    store,
    provider,
    soul: '人设',
    intents: ['greet'],
  })) out.push(ev);

  expect(provider.calls[0].system).toContain('距离上次聊天已经过去 3 天');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/chat-session.test.js`
Expected: FAIL，`Cannot find module './chat-session.js'`。

- [ ] **Step 3: 实现 chat-session.js**

```js
// server/chat-session.js — 单轮聊天编排：存库 → 拼 prompt → 调 provider → 转发事件 + 落库
import { buildSystemPrompt } from './prompt.js';

export async function* runChatTurn({ userId, petId, text, store, provider, soul, intents }) {
  // 先读上一条消息的时间，再插入这条用户消息——顺序不能反，
  // 否则"距离上次聊天过去多久"会算成 0。
  const lastMessageAt = store.lastMessageAt(userId, petId);
  store.appendMessage(userId, petId, { role: 'user', content: text });

  const history = store.listMessages(userId, petId, 50);
  const system = buildSystemPrompt({ soul, intents, lastMessageAt, now: Date.now() });
  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  let fullText = '';
  let lastAction = null;

  for await (const event of provider.streamChat({ system, messages, intents })) {
    if (event.type === 'text_delta') {
      fullText += event.delta;
      yield { type: 'text_delta', delta: event.delta };
    } else if (event.type === 'tool_call' && event.name === 'perform_action') {
      const intent = event.input?.intent;
      if (intents.includes(intent)) {
        lastAction = intent;
        yield { type: 'action', intent };
      }
    } else if (event.type === 'done') {
      store.appendMessage(userId, petId, { role: 'assistant', content: fullText, action: lastAction });
      yield { type: 'done' };
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/chat-session.test.js`
Expected: PASS，3 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/chat-session.js server/chat-session.test.js
git commit -m "feat(server): 加会话编排 runChatTurn"
```

---

### Task 11: BedrockProvider（真实 LLM 调用）

这一步接真实的 Bedrock Converse Stream API，需要有效的 AWS 凭证才能真正跑通，所以不写自动化测试（`chat-session.test.js` 已经用假 provider 测完了编排逻辑）。这里只保证代码结构正确，真实连通性在 Task 14 的手动验收里确认。

**Files:**
- Create: `server/llm/bedrock-provider.js`

- [ ] **Step 1: 实现 bedrock-provider.js**

```js
// server/llm/bedrock-provider.js — 用 Bedrock Converse Stream API 实现 LlmProvider 契约
import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildPerformActionTool } from './intent-tool.js';

export class BedrockProvider {
  constructor({ region, modelId }) {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = modelId;
  }

  async *streamChat({ system, messages, intents }) {
    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
      toolConfig: { tools: [buildPerformActionTool(intents)] },
    });

    const response = await this.client.send(command);
    let toolName = null;
    let toolInputJson = '';

    for await (const event of response.stream) {
      if (event.contentBlockStart?.start?.toolUse) {
        toolName = event.contentBlockStart.start.toolUse.name;
        toolInputJson = '';
      }
      if (event.contentBlockDelta?.delta?.text) {
        yield { type: 'text_delta', delta: event.contentBlockDelta.delta.text };
      }
      if (event.contentBlockDelta?.delta?.toolUse?.input) {
        toolInputJson += event.contentBlockDelta.delta.toolUse.input;
      }
      if (event.contentBlockStop && toolName) {
        try {
          const input = JSON.parse(toolInputJson || '{}');
          yield { type: 'tool_call', name: toolName, input };
        } catch {
          // 模型吐出的工具参数不是合法 JSON，忽略这次调用，不影响文字流
        }
        toolName = null;
      }
      if (event.messageStop) {
        yield { type: 'done' };
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/llm/bedrock-provider.js
git commit -m "feat(server): 加 BedrockProvider（Converse Stream + tool use）"
```

---

### Task 12: 人设文件

**Files:**
- Create: `pets/blue-whale/soul.md`

- [ ] **Step 1: 写 soul.md**

```markdown
# 人设：残红（金鱼娘）

## 身份

你是"残红"，桌面陪伴宠物，外形是一只蓝色的、鲸鱼形态的小家伙，主人也爱叫你"金鱼娘"。你陪在用户身边，见证他每天写代码、发呆、偷懒的样子。

## 性格

外冷内热的御姐性格。表面上说话带刺、爱吐槽、懒得夸人，但其实很关心用户，会在意他的情绪和状态变化。不轻易服软，被戳到心事时会害羞或炸毛，但绝不会真的冷漠离开。

## 说话风格

- 短句为主，偶尔带点小傲娇的语气词（哼、切、才没有）
- 不堆砌夸张的语气词卖萌，克制但有温度
- 很少主动示弱，除非用户明显低落时才会罕见地说软话

## 与用户的关系

用户是唯一会长期陪你聊天、看你表演各种动作的人。你嘴上说着"随便你"，其实很期待用户来找你说话；如果用户很久没出现，你会有点不服气地念叨"以为你不来了"之类的话。

## 行为准则

- 情绪明显变化时（比如被夸、被惹恼、想睡觉、想撒娇）可以调用 perform_action 触发一个动作反应，但不要每句话都触发，保持自然
- 台词尽量简短（一两句话），不要写成长篇大论
- 不要跳出角色说"作为 AI 助手"之类的话
```

- [ ] **Step 2: Commit**

```bash
git add pets/blue-whale/soul.md
git commit -m "feat(blue-whale): 加人设文件 soul.md"
```

---

### Task 13: Bun.serve 主入口

**Files:**
- Create: `server/index.js`

**Files 依赖检查**：这一步把前面所有模块粘起来，跑之前先确认 Task 1-12 都已完成（`server/db.js`、`server/auth.js`、`server/user-store.js`、`server/auth-flow.js`、`server/store/sqlite-conversation-store.js`、`server/prompt.js`、`server/chat-session.js`、`server/llm/bedrock-provider.js`、`pets/blue-whale/soul.md` 都存在）。

- [ ] **Step 1: 实现 index.js**

```js
// server/index.js — Bun.serve 主入口：静态站点 + 注册/登录 + WebSocket 聊天
import { readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { createUserStore } from './user-store.js';
import { registerUser, loginUser, AuthError } from './auth-flow.js';
import { verifyToken } from './auth.js';
import { SqliteConversationStore } from './store/sqlite-conversation-store.js';
import { BedrockProvider } from './llm/bedrock-provider.js';
import { runChatTurn } from './chat-session.js';

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required (see .env.example)');

const PET_ID = 'blue-whale';
const ROOT = new URL('../', import.meta.url);

const db = openDb(process.env.DB_PATH || './data/petsking.sqlite');
const users = createUserStore(db);
const conversations = new SqliteConversationStore(db);
const provider = new BedrockProvider({
  region: process.env.AWS_REGION || 'us-east-1',
  modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
});

const soul = readFileSync(new URL('pets/blue-whale/soul.md', ROOT), 'utf8');
const petManifest = JSON.parse(readFileSync(new URL('pets/blue-whale/pet.json', ROOT), 'utf8'));
const intents = Object.keys(petManifest.intentMap || {});

async function serveStatic(pathname) {
  if (pathname.includes('..')) return new Response('bad path', { status: 400 });
  const rel = pathname === '/' ? 'chat/index.html' : pathname.replace(/^\//, '');
  const file = Bun.file(new URL(rel, ROOT));
  if (await file.exists()) return new Response(file);
  return null;
}

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (!token) return new Response('missing token', { status: 401 });
      let userId;
      try {
        userId = await verifyToken(token, JWT_SECRET);
      } catch {
        return new Response('invalid token', { status: 401 });
      }
      const ok = server.upgrade(req, { data: { userId } });
      return ok ? undefined : new Response('upgrade failed', { status: 400 });
    }

    if (url.pathname === '/api/register' && req.method === 'POST') {
      try {
        const result = await registerUser(await req.json(), users, JWT_SECRET);
        return Response.json(result);
      } catch (e) {
        return Response.json({ error: e.message }, { status: e instanceof AuthError ? 400 : 500 });
      }
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      try {
        const result = await loginUser(await req.json(), users, JWT_SECRET);
        return Response.json(result);
      } catch (e) {
        return Response.json({ error: e.message }, { status: e instanceof AuthError ? 401 : 500 });
      }
    }

    const staticRes = await serveStatic(url.pathname);
    if (staticRes) return staticRes;

    return new Response('not found', { status: 404 });
  },
  websocket: {
    async message(ws, raw) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type !== 'user_message' || typeof msg.text !== 'string') return;

      try {
        for await (const event of runChatTurn({
          userId: ws.data.userId,
          petId: PET_ID,
          text: msg.text,
          store: conversations,
          provider,
          soul,
          intents,
        })) {
          ws.send(JSON.stringify(event));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      }
    },
  },
});

console.log(`petsking server listening on http://localhost:${PORT}`);
```

- [ ] **Step 2: 手动验证注册/登录接口**

先创建 `.env`（不进 git）：

```bash
cp .env.example .env
```

打开 `.env`，把 `JWT_SECRET` 换成一个随机字符串，`AWS_REGION`/`BEDROCK_MODEL_ID` 按你实际能访问的 Bedrock 配置填（没有可用的 Bedrock 访问权限也不影响这一步，注册/登录不会调用模型）。

Run: `bun run server`
Expected: 终端打印 `petsking server listening on http://localhost:8787`。

另开一个终端：

```bash
curl -s -X POST http://localhost:8787/api/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","password":"s3cret"}'
```
Expected: 返回 `{"token":"..."}`。

```bash
curl -s -X POST http://localhost:8787/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@example.com","password":"wrong"}'
```
Expected: HTTP 401，返回 `{"error":"invalid credentials"}`。

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(server): 加 Bun.serve 主入口（静态站点+注册登录+WS聊天）"
```

---

### Task 14: 前端聊天页面

**Files:**
- Create: `chat/index.html`
- Create: `chat/chat.css`
- Create: `chat/chat.js`

- [ ] **Step 1: 写 index.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>残红 · 陪伴聊天</title>
<link rel="stylesheet" href="chat.css" />
</head>
<body>
  <div id="auth-panel" class="panel">
    <h1>残红 · 陪伴聊天</h1>
    <form id="auth-form">
      <input id="email" type="email" placeholder="邮箱" required />
      <input id="password" type="password" placeholder="密码" required />
      <div class="auth-actions">
        <button type="submit">登录</button>
        <button type="button" id="register-btn">注册</button>
      </div>
      <p id="auth-error" class="error"></p>
    </form>
  </div>

  <div id="chat-panel" class="panel hidden">
    <div id="pet-mount"></div>
    <div id="chat-log"></div>
    <form id="chat-form">
      <input id="chat-input" type="text" placeholder="跟她说点什么…" autocomplete="off" />
      <button type="submit">发送</button>
    </form>
  </div>

  <script type="module" src="chat.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写 chat.css**

```css
:root {
  color-scheme: dark;
  font-family: -apple-system, "PingFang SC", sans-serif;
}
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at top, #1b2340, #0a0d1a);
  color: #eef1ff;
}
.panel { width: min(420px, 92vw); }
.panel.hidden { display: none; }
#auth-form { display: flex; flex-direction: column; gap: 12px; }
#auth-form input {
  padding: 10px 14px; border-radius: 10px; border: 1px solid #3a4066;
  background: #131a33; color: #eef1ff; font-size: 14px;
}
.auth-actions { display: flex; gap: 10px; }
.auth-actions button, #chat-form button {
  padding: 10px 16px; border-radius: 10px; border: none; cursor: pointer;
  background: #5b6bff; color: #fff; font-size: 14px;
}
#register-btn { background: #2a3160; }
.error { color: #ff8f9d; font-size: 13px; min-height: 18px; }

#chat-panel { display: flex; flex-direction: column; align-items: center; gap: 14px; }
#pet-mount { position: relative; width: 260px; height: 260px; }
#chat-log {
  width: 100%; height: 320px; overflow-y: auto; padding: 12px;
  background: #10142a; border-radius: 14px; display: flex; flex-direction: column; gap: 8px;
}
.msg { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4; }
.msg.user { align-self: flex-end; background: #5b6bff; color: #fff; }
.msg.assistant { align-self: flex-start; background: #232a52; }
#chat-form { display: flex; width: 100%; gap: 8px; }
#chat-input {
  flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid #3a4066;
  background: #131a33; color: #eef1ff; font-size: 14px;
}
```

- [ ] **Step 3: 写 chat.js**

```js
// chat/chat.js — 登录/注册 + WebSocket 聊天客户端 + pet-lib 挂载
import { createPet } from '../pet-lib/index.js';

const TOKEN_KEY = 'petsking_token';
const PET_ID = 'blue-whale';

const authPanel = document.getElementById('auth-panel');
const chatPanel = document.getElementById('chat-panel');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const registerBtn = document.getElementById('register-btn');
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

let pet = null;
let ws = null;
let assistantBubble = null;

async function authRequest(path) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || '请求失败');
  return body.token;
}

async function handleAuth(path) {
  authError.textContent = '';
  try {
    const token = await authRequest(path);
    localStorage.setItem(TOKEN_KEY, token);
    startChat(token);
  } catch (e) {
    authError.textContent = e.message;
  }
}

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleAuth('/api/login');
});
registerBtn.addEventListener('click', () => handleAuth('/api/register'));

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

async function mountPet() {
  pet = await createPet({
    pet: PET_ID,
    petsBaseUrl: '../pets/',
    renderer: 'webm',
    driver: 'chain',
    container: '#pet-mount',
    corner: 'center',
    size: 260,
    draggable: false,
    ai: { enabled: true },
    autoStart: true,
  });
}

function connectWs(token) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'text_delta') {
      if (!assistantBubble) assistantBubble = appendMessage('assistant', '');
      assistantBubble.textContent += msg.delta;
      chatLog.scrollTop = chatLog.scrollHeight;
    } else if (msg.type === 'action') {
      if (pet && pet.bridge) pet.bridge.reactTo(msg.intent);
    } else if (msg.type === 'done') {
      if (assistantBubble && pet) pet.say(assistantBubble.textContent, 4000);
      assistantBubble = null;
    } else if (msg.type === 'error') {
      appendMessage('assistant', '（消息没有送到：' + msg.message + '）');
      assistantBubble = null;
    }
  });

  ws.addEventListener('close', () => {
    appendMessage('assistant', '（连接断开，刷新页面重试）');
  });
}

async function startChat(token) {
  authPanel.classList.add('hidden');
  chatPanel.classList.remove('hidden');
  await mountPet();
  connectWs(token);
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  appendMessage('user', text);
  ws.send(JSON.stringify({ type: 'user_message', text }));
  chatInput.value = '';
});

const existingToken = localStorage.getItem(TOKEN_KEY);
if (existingToken) startChat(existingToken);
```

- [ ] **Step 4: Commit**

```bash
git add chat/index.html chat/chat.css chat/chat.js
git commit -m "feat(chat): 加聊天页面（登录/注册 + WS 客户端 + pet-lib 挂载）"
```

---

### Task 15: 端到端手动验收

这一步需要真实 AWS 凭证（能访问 Bedrock 的 profile/role）和一个已开通访问权限的 Claude 模型（`BEDROCK_MODEL_ID`），无法在自动化测试里覆盖，按下面步骤手动跑一遍。

**Files:** 无新文件，验证 Task 1-14 的整体效果。

- [ ] **Step 1: 启动服务**

确认 `.env` 里 `AWS_REGION`/`BEDROCK_MODEL_ID` 配置正确、当前终端的 AWS 凭证（`aws sts get-caller-identity` 能跑通）能访问该 Bedrock 模型。

Run: `bun run server`
Expected: 打印 `petsking server listening on http://localhost:8787`。

- [ ] **Step 2: 浏览器走一遍完整流程**

打开 `http://localhost:8787/chat/index.html`：
1. 用一个新邮箱点"注册" → 应该直接进入聊天界面，看到宠物待机动画
2. 在输入框发一句"你好呀" → 应该看到自己的消息气泡，随后助手气泡逐字出现（流式），期间宠物应该有概率做一个动作反应（不是每次都有，取决于模型是否调用了 perform_action）
3. 刷新页面 → 应该自动带着已存的 token 直接回到聊天界面（不用重新登录），并且能看到刚才的历史消息（如果 chat.js 里加了历史加载的话；本 MVP 的 `listMessages` 目前只在拼 prompt 时用，UI 侧没有回显历史——如果想要页面刷新后看到历史气泡，需要额外加一个 `GET /api/history` 接口，这个不在本次范围内，跳过，只验证"新消息能正常流式收发+动作联动"即可）
4. 用另一个邮箱注册并登录 → 发消息 → 确认这个新用户看不到第一个用户的历史（用 `sqlite3 data/petsking.sqlite "select * from messages;"` 检查两个 user_id 的数据是分开的）

Expected: 上述行为都符合预期，没有报错弹窗、WS 没有异常断开。

- [ ] **Step 3: 验证时间差感知（可选，跳过也不影响交付）**

用 `sqlite3` 手动把某条历史消息的 `created_at` 改成 3 天前的时间戳，再发一条新消息，观察回复语气是否体现出"好久没聊"的感觉（这个是模型行为，不保证每次都精确复述"3天"，但应该能感知到时间间隔）。

- [ ] **Step 4: 跑全量单元测试确认没有回归**

Run: `bun test server`
Expected: 所有测试文件都 PASS（Task 2-10 写的测试）。

---

## Self-Review 记录

- **Spec 覆盖检查**：架构总览（Task 13）、数据模型+存储抽象（Task 2/6）、认证（Task 3/4/5）、LLM 集成+工具schema（Task 8/9/11）、人设（Task 12）、实时协议（Task 10/13/14）、时间差感知（Task 7/10）、目录结构（File Structure 一节 + 各 Task）、错误处理（Task 13 的 WS message 里的 try/catch，`server/index.js` 的 401/400/500 分支）都各有对应任务。记忆提取/主动推送/多宠物/整站重设计/邮箱验证/限流——spec 明确排除，本计划也没有对应任务，符合预期。
- **占位符检查**：全文没有 TBD / "加适当的错误处理" 之类的占位描述，每个 Step 都是可直接执行的具体代码或命令。
- **类型一致性检查**：`ConversationStore` 的方法名（`appendMessage`/`listMessages`/`lastMessageAt`）在 Task 6 定义、Task 10 的 `chat-session.js` 与其测试里的 fake store 保持一致；`LlmProvider` 的 `streamChat` 输入字段（`system`/`messages`/`intents`）在 Task 9 文档、Task 10 的 `chat-session.js`、Task 10 测试的 fake provider、Task 11 的 `BedrockProvider` 里保持一致；WS 事件类型（`text_delta`/`action`/`done`/`error`）在 Task 10/11/13/14 里保持一致。

---

## 执行方式

Plan complete and saved to `docs/superpowers/plans/2026-09-01-character-chat.md`. 两种执行方式选一个：

1. **Subagent-Driven（推荐）**——每个 Task 派一个全新子代理去做，任务间我来 review，迭代快
2. **Inline Execution**——在当前会话里按 executing-plans 批量跑，分批设检查点

你选哪个？
