# Dashboard 互动入口 + 多宠物聊天（webm 范围）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把聊天功能从孤立的 `chat/index.html` 接入现有的宠物展示系统——合并成一套 Bun server，`dashboard/` 每张 webm 宠物卡片加"互动"入口，没有专属人设的宠物（残红/早雾）走通用兜底人设。

**Architecture:** `server/index.js` 的静态白名单扩到覆盖首页/dashboard/playground/docs/assets/tools；新增一个纯函数 `server/pet-registry.js` 在启动时从 `pets/index.json` 筛出 webm 渲染器的宠物，读各自的 `pet.json`（intentMap）+ 尝试读 `soul.md`（没有就用兜底文案），组成一张按 `pet id` 查的注册表；`/ws` 新增必需的 `?pet=` 参数，按连接选人设/intents，不再是模块级常量。前端：`dashboard.js` 卡片改双链接结构，`chat/` 三个文件小改（导航栏+配色对齐+读 `?pet=` 参数+动态标题）。

**Tech Stack:** 沿用现有 Bun + bun:sqlite + bun:test，纯 ESM JS，无构建步骤。

参考设计文档：`docs/superpowers/specs/2026-09-02-dashboard-chat-integration-design.md`

---

## File Structure

```
server/
  pet-registry.js         # 新增：纯函数，从 pets/index.json 构建"可聊天宠物"注册表
  pet-registry.test.js    # 新增：对应测试
  index.js                # 修改：接入注册表、扩静态白名单、目录 index.html 兜底、/ws 按 pet 校验

dashboard/
  index.html              # 修改：卡片区加 .card-actions 样式
  dashboard.js             # 修改：每张卡片渲染两个动作链接（展示皮肤 + 条件性的互动）

chat/
  index.html               # 修改：加导航栏，标题不再硬编码
  chat.css                 # 修改：配色变量对齐首页深色主题，加 nav 样式
  chat.js                  # 修改：读 ?pet= 参数、fetch 宠物名动态填标题、WS 带 pet 参数

README.md                  # 修改：快速开始合并成单一 bun run server 流程；聊天说明更新为三个 webm 宠物
```

---

### Task 1: 宠物聊天注册表（纯函数）

**Files:**
- Create: `server/pet-registry.js`
- Test: `server/pet-registry.test.js`

- [ ] **Step 1: 写失败的测试**

```js
// server/pet-registry.test.js
import { test, expect } from 'bun:test';
import { buildPetRegistry, FALLBACK_SOUL } from './pet-registry.js';

test('buildPetRegistry only includes webm-renderer pets', () => {
  const petsIndex = {
    pets: [
      { id: 'a', renderers: ['webm'], path: 'a/pet.json' },
      { id: 'b', renderers: ['gif'], path: 'b/pet.json' },
    ],
  };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { greet: 'wave' } }),
    readSoul: () => 'custom soul',
  });
  expect(registry.has('a')).toBe(true);
  expect(registry.has('b')).toBe(false);
});

test('buildPetRegistry falls back to the generic soul when readSoul returns null', () => {
  const petsIndex = { pets: [{ id: 'a', renderers: ['webm'], path: 'a/pet.json' }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { happy: 'cheer' } }),
    readSoul: () => null,
  });
  expect(registry.get('a').soul).toBe(FALLBACK_SOUL);
  expect(registry.get('a').intents).toEqual(['happy']);
});

test('buildPetRegistry uses the real soul when readSoul returns text', () => {
  const petsIndex = { pets: [{ id: 'a', renderers: ['webm'], path: 'a/pet.json' }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: {} }),
    readSoul: () => '专属人设文本',
  });
  expect(registry.get('a').soul).toBe('专属人设文本');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test server/pet-registry.test.js`
Expected: FAIL，`Cannot find module './pet-registry.js'`。

- [ ] **Step 3: 实现 pet-registry.js**

```js
// server/pet-registry.js — 从 pets/index.json 构建"可聊天宠物"注册表（目前只收 webm 渲染器）
export const FALLBACK_SOUL = `你是桌面陪伴宠物，用户还没有为你写专属人设。用简短、友好、略带活泼的语气正常聊天即可，不用扮演任何特定角色设定。
你可以在合适的时候调用 perform_action 触发一个动作反应，但不要每句话都调用。
台词尽量简短（一两句话）。`;

export function buildPetRegistry(petsIndex, { readManifest, readSoul }) {
  const registry = new Map();
  for (const entry of petsIndex.pets) {
    if (!entry.renderers || !entry.renderers.includes('webm')) continue;
    const manifest = readManifest(entry);
    const intents = Object.keys(manifest.intentMap || {});
    const soul = readSoul(entry) ?? FALLBACK_SOUL;
    registry.set(entry.id, { soul, intents });
  }
  return registry;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test server/pet-registry.test.js`
Expected: PASS，3 个测试都通过。

- [ ] **Step 5: Commit**

```bash
git add server/pet-registry.js server/pet-registry.test.js
git commit -m "feat(server): 加多宠物聊天注册表（webm 范围 + 兜底人设）"
```

---

### Task 2: server/index.js 接入注册表 + 扩静态白名单

**Files:**
- Modify: `server/index.js`（整个文件替换成下面的内容）

这一步把 Task 1 的注册表接进 server 启动流程，同时做三件相关的事：静态白名单从 3 个目录扩到覆盖首页/dashboard/playground/docs/assets/tools；`/` 的兜底从 `chat/index.html` 换成站点首页 `index.html`；新增"目录路径兜底 index.html"的逻辑——之前只有根路径 `/` 会兜底成 `index.html`，`/dashboard/`、`/playground/` 这种目录形式的路径并不会自动找 `index.html`，静态白名单只覆盖 `chat/`/`pets/`/`pet-lib/` 时这个问题不会暴露（因为没人以目录形式访问那三个），但现在要通过浏览器实际导航到 `/dashboard/`、`/playground/` 时就会命中，所以要一起修。

**依赖检查**：跑之前确认 Task 1 已完成（`server/pet-registry.js` 存在）。

- [ ] **Step 1: 用下面的内容整体替换 server/index.js**

```js
// server/index.js — Bun.serve 主入口：静态站点 + 注册/登录 + WebSocket 聊天
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './db.js';
import { createUserStore } from './user-store.js';
import { registerUser, loginUser, AuthError } from './auth-flow.js';
import { verifyToken } from './auth.js';
import { SqliteConversationStore } from './store/sqlite-conversation-store.js';
import { BedrockProvider } from './llm/bedrock-provider.js';
import { runChatTurn } from './chat-session.js';
import { buildPetRegistry } from './pet-registry.js';

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required (see .env.example)');

const ROOT = new URL('../', import.meta.url);

const dbPath = process.env.DB_PATH || './data/petsking.sqlite';
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const users = createUserStore(db);
const conversations = new SqliteConversationStore(db);
const provider = new BedrockProvider({
  region: process.env.AWS_REGION || 'us-east-1',
  modelId: process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
});

const petsIndex = JSON.parse(readFileSync(new URL('pets/index.json', ROOT), 'utf8'));
const PET_REGISTRY = buildPetRegistry(petsIndex, {
  readManifest: (entry) => JSON.parse(readFileSync(new URL('pets/' + entry.path, ROOT), 'utf8')),
  readSoul: (entry) => {
    try {
      return readFileSync(new URL(`pets/${entry.id}/soul.md`, ROOT), 'utf8');
    } catch {
      return null;
    }
  },
});

const STATIC_ALLOWLIST = ['chat/', 'pets/', 'pet-lib/', 'dashboard/', 'playground/', 'docs/', 'assets/', 'tools/', 'index.html'];

async function serveStatic(pathname) {
  // url.pathname is already dot-segment-normalized by the URL constructor, so this
  // can't currently be hit — kept as defense-in-depth in case pathname is ever
  // built differently (e.g. from a raw header) without that normalization.
  if (pathname.includes('..')) return new Response('bad path', { status: 400 });
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  if (rel.endsWith('/')) rel += 'index.html';
  if (!STATIC_ALLOWLIST.some((prefix) => rel.startsWith(prefix))) return null;
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
      const petId = url.searchParams.get('pet');
      if (!token) return new Response('missing token', { status: 401 });
      if (!petId || !PET_REGISTRY.has(petId)) return new Response('unknown pet', { status: 400 });
      let userId;
      try {
        userId = await verifyToken(token, JWT_SECRET);
      } catch {
        return new Response('invalid token', { status: 401 });
      }
      const ok = server.upgrade(req, { data: { userId, petId } });
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
      if (ws.data.turnInFlight) return; // drop concurrent messages on the same connection
      ws.data.turnInFlight = true;

      const { soul, intents } = PET_REGISTRY.get(ws.data.petId);
      try {
        for await (const event of runChatTurn({
          userId: ws.data.userId,
          petId: ws.data.petId,
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
      } finally {
        ws.data.turnInFlight = false;
      }
    },
  },
});

console.log(`petsking server listening on http://localhost:${PORT}`);
```

- [ ] **Step 2: 跑现有测试确认没有回归**

Run: `bun test`
Expected: 全部 PASS（28 个原有测试 + Task 1 新增的 3 个，应该是 31 pass）。

- [ ] **Step 3: 手动验证路由（不需要 AWS 凭证的部分）**

```bash
bun run server &
sleep 1
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/                        # 期待 200（首页）
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/dashboard/              # 期待 200（目录兜底 index.html 生效）
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8787/playground/             # 期待 200
curl -s http://localhost:8787/ | grep -o "Pet's King" | head -1                        # 期待输出 Pet's King（确认真的是首页内容，不是聊天页）
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/ws"                    # 期待 401（缺 token）
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/ws?token=x"             # 期待 400（缺 pet 参数）
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:8787/ws?token=x&pet=nope"     # 期待 400（未知 pet）
kill %1
```

Expected: 依次输出 `200 / 200 / 200 / Pet's King / 401 / 400 / 400`。

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(server): 静态白名单扩到整站 + 目录 index.html 兜底 + /ws 按 pet 校验"
```

---

### Task 3: dashboard 卡片改双链接结构

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/dashboard.js`

- [ ] **Step 1: 在 dashboard/index.html 的 `<style>` 里替换卡片链接样式**

找到这一行：
```css
  .card .go{font-size:12px;color:var(--accent);margin-top:10px;display:inline-block;}
```
替换成：
```css
  .card-actions{display:flex;gap:14px;margin-top:10px;}
  .card-actions a{font-size:12px;color:var(--accent);}
  .card-actions a:hover{text-decoration:underline;}
```

- [ ] **Step 2: 修改 dashboard/dashboard.js 的卡片渲染逻辑**

把这一段（当前 `for (const pack of list) { ... }` 循环体）：

```js
    for (const pack of list) {
      const card = document.createElement('a');
      card.className = 'card';
      card.href = `../playground/?pet=${encodeURIComponent(pack.id)}&renderer=${encodeURIComponent(r)}`;
      card.innerHTML =
        `<div class="ico">${info.icon}</div>` +
        `<h3>${pack.meta.name || pack.name || pack.id}</h3>` +
        `<p>${pack.meta.description || ''}</p>` +
        `<div class="rtags">${(pack.renderers || []).map((x) => `<span class="rtag">${x}</span>`).join('')}` +
        `<span class="rtag" style="background:rgba(255,255,255,0.06);color:#8a90ad">${pack.actions} 动作</span></div>` +
        `<span class="go">进 Playground →</span>`;
      grid.appendChild(card);
    }
```

替换成：

```js
    for (const pack of list) {
      const card = document.createElement('div');
      card.className = 'card';
      const playgroundHref = `../playground/?pet=${encodeURIComponent(pack.id)}&renderer=${encodeURIComponent(r)}`;
      const chatHref = `../chat/index.html?pet=${encodeURIComponent(pack.id)}`;
      const canChat = (pack.renderers || []).includes('webm');
      card.innerHTML =
        `<div class="ico">${info.icon}</div>` +
        `<h3>${pack.meta.name || pack.name || pack.id}</h3>` +
        `<p>${pack.meta.description || ''}</p>` +
        `<div class="rtags">${(pack.renderers || []).map((x) => `<span class="rtag">${x}</span>`).join('')}` +
        `<span class="rtag" style="background:rgba(255,255,255,0.06);color:#8a90ad">${pack.actions} 动作</span></div>` +
        `<div class="card-actions">` +
          `<a href="${playgroundHref}">🎭 展示皮肤 →</a>` +
          (canChat ? `<a href="${chatHref}">💬 互动 →</a>` : '') +
        `</div>`;
      grid.appendChild(card);
    }
```

- [ ] **Step 3: 手动验证**

```bash
bun run server &
sleep 1
```

打开浏览器访问 `http://localhost:8787/dashboard/`：
- webm 分组下的三张卡片（蓝鲸小助手、残红、早雾）应该各有"🎭 展示皮肤 →"和"💬 互动 →"两个链接
- 其他分组（gif/pixel/svg/three）的卡片应该只有"🎭 展示皮肤 →"，没有"互动"
- 点"展示皮肤"应该照常进 playground
- 点"互动"应该进 `chat/index.html?pet=<对应id>`（这一步先只确认路由对了，页面内容验证留给 Task 5）

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html dashboard/dashboard.js
git commit -m "feat(dashboard): webm 宠物卡片加互动入口"
```

---

### Task 4: chat 页面加导航栏 + 配色对齐

**Files:**
- Modify: `chat/index.html`
- Modify: `chat/chat.css`

- [ ] **Step 1: 用下面的内容整体替换 chat/index.html**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title id="page-title">陪伴聊天 · Pet's King</title>
<link rel="stylesheet" href="chat.css" />
</head>
<body>
  <nav class="nav">
    <div class="wrap">
      <a class="brand" href="../index.html"><span class="dot">🐾</span> Pet's King</a>
      <div class="links">
        <a href="../index.html">首页</a>
        <a href="../dashboard/">宠物库</a>
      </div>
    </div>
  </nav>

  <main class="wrap">
    <div id="auth-panel" class="panel">
      <h1 id="auth-title">陪伴聊天</h1>
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
  </main>

  <script type="module" src="chat.js"></script>
</body>
</html>
```

- [ ] **Step 2: 用下面的内容整体替换 chat/chat.css**

```css
:root {
  color-scheme: dark;
  --bg:#0b0d14;
  --bg-soft:#11131d;
  --card:#161927;
  --card-hi:#1c2033;
  --line:rgba(255,255,255,0.07);
  --line-hi:rgba(255,255,255,0.14);
  --fg:#eef0f8;
  --muted:#9096b3;
  --muted-dim:#666c88;
  --accent:#6d8bff;
  --accent-2:#b06dff;
  --accent-glow:rgba(109,139,255,0.35);
  font-family: -apple-system, "PingFang SC", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--fg);
  background-image:
    radial-gradient(900px 500px at 82% -8%, rgba(176,109,255,0.14), transparent 60%),
    radial-gradient(1000px 560px at 8% -4%, rgba(109,139,255,0.16), transparent 62%);
  background-attachment: fixed;
}
a { color: inherit; text-decoration: none; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

.nav { position: sticky; top: 0; z-index: 20;
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  background: rgba(11,13,20,0.72); border-bottom: 1px solid var(--line); }
.nav .wrap { display: flex; align-items: center; justify-content: space-between; height: 60px; }
.nav .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .3px; }
.nav .brand .dot { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 15px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 4px 16px var(--accent-glow); }
.nav .links { display: flex; gap: 8px; align-items: center; }
.nav .links a { padding: 7px 14px; border-radius: 9px; font-size: 13.5px; color: var(--muted); transition: .15s; }
.nav .links a:hover { color: var(--fg); background: rgba(255,255,255,0.06); }

main.wrap {
  display: flex; flex-direction: column; align-items: center;
  min-height: calc(100vh - 60px); justify-content: center; padding: 40px 24px;
}
.panel { width: min(420px, 92vw); }
.panel.hidden { display: none; }
#auth-title { text-align: center; }
#auth-form { display: flex; flex-direction: column; gap: 12px; }
#auth-form input {
  padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line-hi);
  background: var(--card); color: var(--fg); font-size: 14px;
}
.auth-actions { display: flex; gap: 10px; }
.auth-actions button, #chat-form button {
  padding: 10px 16px; border-radius: 10px; border: none; cursor: pointer;
  background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; font-size: 14px;
}
#register-btn { background: var(--card-hi); border: 1px solid var(--line-hi); }
.error { color: #ff8f9d; font-size: 13px; min-height: 18px; }

#chat-panel { display: flex; flex-direction: column; align-items: center; gap: 14px; }
#pet-mount { position: relative; width: 260px; height: 260px; }
#chat-log {
  width: 100%; height: 320px; overflow-y: auto; padding: 12px;
  background: var(--bg-soft); border: 1px solid var(--line); border-radius: 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.msg { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4; }
.msg.user { align-self: flex-end; background: var(--accent); color: #fff; }
.msg.assistant { align-self: flex-start; background: var(--card-hi); border: 1px solid var(--line); }
#chat-form { display: flex; width: 100%; gap: 8px; }
#chat-input {
  flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line-hi);
  background: var(--card); color: var(--fg); font-size: 14px;
}
```

- [ ] **Step 3: Commit**

```bash
git add chat/index.html chat/chat.css
git commit -m "feat(chat): 加导航栏 + 配色对齐站点主题"
```

---

### Task 5: chat.js 支持按 ?pet= 参数切换宠物

**Files:**
- Modify: `chat/chat.js`

**依赖检查**：确认 Task 4 已完成（`chat/index.html` 里有 `id="auth-title"`，Task 5 要用到）。

- [ ] **Step 1: 用下面的内容整体替换 chat/chat.js**

```js
// chat/chat.js — 登录/注册 + WebSocket 聊天客户端 + pet-lib 挂载
import { createPet } from '../pet-lib/index.js';

const TOKEN_KEY = 'petsking_token';
const params = new URLSearchParams(location.search);
const PET_ID = params.get('pet') || 'blue-whale';

const authPanel = document.getElementById('auth-panel');
const chatPanel = document.getElementById('chat-panel');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const authTitle = document.getElementById('auth-title');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const registerBtn = document.getElementById('register-btn');
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

let pet = null;
let ws = null;
let assistantBubble = null;

async function loadPetName() {
  let name = PET_ID;
  try {
    const res = await fetch(`../pets/${PET_ID}/pet.json`);
    const manifest = await res.json();
    if (manifest.meta && manifest.meta.name) name = manifest.meta.name;
  } catch {
    // 拿不到就用 id 兜底，不影响后续流程
  }
  document.title = name + ' · 陪伴聊天';
  authTitle.textContent = name + ' · 陪伴聊天';
}

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
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&pet=${encodeURIComponent(PET_ID)}`);

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
    localStorage.removeItem(TOKEN_KEY);
    chatPanel.classList.add('hidden');
    authPanel.classList.remove('hidden');
    authError.textContent = '登录已失效或连接断开，请重新登录';
  });
}

async function startChat(token) {
  chatLog.innerHTML = '';
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

loadPetName();
const existingToken = localStorage.getItem(TOKEN_KEY);
if (existingToken) startChat(existingToken);
```

- [ ] **Step 2: 语法检查**

Run: `node --check chat/chat.js`
Expected: 无输出（通过）。

- [ ] **Step 3: Commit**

```bash
git add chat/chat.js
git commit -m "feat(chat): 支持 ?pet= 参数切换宠物 + 动态标题"
```

---

### Task 6: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 替换"🚀 快速开始"整节**

把当前的：

```markdown
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
```

替换成：

```markdown
## 🚀 快速开始

```sh
git clone git@github.com:claw-works/petsking.git
cd petsking
bun install
cp .env.example .env
# 编辑 .env：JWT_SECRET 填一个随机字符串；AWS_REGION / BEDROCK_MODEL_ID 按你的 AWS 账号调整（只影响陪伴聊天功能）
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
```

- [ ] **Step 2: 替换"💬 角色培养聊天"整节**

把当前的：

```markdown
## 💬 角色培养聊天

一个可跑起来的示例应用：邮箱密码登录后，与桌宠角色（当前仅 `blue-whale`）打字聊天，回复由 Amazon Bedrock（Claude）驱动，并可通过 tool-use 触发桌宠动画；每个用户的对话历史落地 SQLite 持久化。

前置条件：

- 已安装 [Bun](https://bun.sh)
- 一个具备 Bedrock 访问权限的 AWS 账号，且已在该账号里启用所选模型（默认用跨区域推理配置 ID `us.anthropic.claude-sonnet-4-5-...`）

```sh
bun install
cp .env.example .env
# 编辑 .env：JWT_SECRET 填一个随机字符串；AWS_REGION / BEDROCK_MODEL_ID 按你的 AWS 账号调整
bun run server
# 打开 http://localhost:8787/，注册账号即可开始聊天
```

> 当前限定单角色（blue-whale）；登录态 30 天后过期，过期需清浏览器数据重新登录，暂未做应用内自动续期 —— 这是当前 MVP 的已知取舍，不是待修 bug。

设计文档：[character-chat-design.md](docs/superpowers/specs/2026-09-01-character-chat-design.md) · 实施计划：[character-chat.md](docs/superpowers/plans/2026-09-01-character-chat.md)。
```

替换成：

```markdown
## 💬 角色培养聊天

`blue-whale`、`残红(canhong)`、`早雾(zaowu)` 三个 webm 宠物支持在 `/chat/?pet=<id>` 打字聊天（也可以从 `/dashboard/` 对应卡片的"互动"链接进入），回复由 Amazon Bedrock（Claude）驱动，可通过 tool-use 触发桌宠动画；每个用户的对话历史按 `(用户, 宠物)` 落地 SQLite 持久化，互不可见。

前置条件：

- 已安装 [Bun](https://bun.sh)
- 一个具备 Bedrock 访问权限的 AWS 账号，且已在该账号里启用所选模型（默认用跨区域推理配置 ID `us.anthropic.claude-sonnet-4-5-...`）

只有 `blue-whale` 配了专属人设（`pets/blue-whale/soul.md`）；残红和早雾还没配，聊天时会走一段通用助手兜底文案。

> 登录态 30 天后过期，过期需清浏览器数据重新登录，暂未做应用内自动续期 —— 这是当前 MVP 的已知取舍，不是待修 bug。

设计文档：[character-chat-design.md](docs/superpowers/specs/2026-09-01-character-chat-design.md)、[dashboard-chat-integration-design.md](docs/superpowers/specs/2026-09-02-dashboard-chat-integration-design.md) · 实施计划：[character-chat.md](docs/superpowers/plans/2026-09-01-character-chat.md)、[dashboard-chat-integration.md](docs/superpowers/plans/2026-09-02-dashboard-chat-integration.md)。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README 更新为整站合并 + 三个 webm 宠物可聊天"
```

---

### Task 7: 端到端手动验收（需要真实 AWS Bedrock 凭证）

**Files:** 无新文件，验证 Task 1-6 的整体效果。

- [ ] **Step 1: 启动服务**

确认 `.env` 里 `AWS_REGION`/`BEDROCK_MODEL_ID` 配置正确、当前终端的 AWS 凭证能访问该 Bedrock 模型（`aws sts get-caller-identity` 能跑通）。

Run: `bun run server`
Expected: 打印 `petsking server listening on http://localhost:8787`。

- [ ] **Step 2: 浏览器走一遍完整路径**

打开 `http://localhost:8787/`：
1. 首页正常显示（不是聊天登录页），导航栏点"宠物库"进 `/dashboard/`
2. dashboard 上确认：`blue-whale`/`残红`/`早雾` 三张卡片各有"展示皮肤"+"互动"两个链接；其他渲染方案分组（gif/像素/svg/three）的卡片只有"展示皮肤"
3. 点某张 webm 卡片的"展示皮肤" → 正常进 playground，功能和之前一样
4. 回 dashboard，点"互动" → 进聊天页，标题显示对应宠物的中文名（不是写死的"残红"），页面有导航栏能点回首页/宠物库
5. 注册一个账号，登录，分别用 blue-whale 和 残红（或早雾）发消息 → 两个都能收到流式回复；blue-whale 应该体现出"残红人设"的语气（外冷内热），残红/早雾走通用助手语气也能正常聊，不报错
6. 用 sqlite 确认两个宠物的对话历史 `pet_id` 不同、互不影响：
   ```bash
   sqlite3 data/petsking.sqlite "select pet_id, count(*) from messages group by pet_id;"
   ```
   期待看到至少两个不同的 `pet_id` 各有消息数

- [ ] **Step 3: 跑全量单元测试确认没有回归**

Run: `bun test`
Expected: 全部 PASS。

- [ ] **Step 4: 停止服务，确认没有残留进程**

```bash
kill %1 2>/dev/null; pgrep -f "bun run server" || echo "no lingering process"
```

---

## Self-Review 记录

- **Spec 覆盖检查**：服务合并+路由（Task 2）、通用兜底人设+多宠物注册表（Task 1、2）、WS 按 pet 校验（Task 2）、dashboard 双链接（Task 3）、聊天页导航+配色（Task 4）、`?pet=` 参数+动态标题（Task 5）、README 同步（Task 6）——spec 里的每一条都有对应任务。非目标（非 webm 渲染器聊天、聊天页整体重排版、记忆/主动发言）本计划里没有涉及，符合预期。
- **占位符检查**：全文没有 TBD，每个 Step 都是可直接执行的具体代码/命令。
- **一致性检查**：`PET_REGISTRY.get(petId)` 返回的 `{soul, intents}` 形状在 Task 1（`buildPetRegistry` 定义+测试）和 Task 2（`server/index.js` 使用处）保持一致；`ws.data.petId` 在 Task 2 的 upgrade 处赋值、message 处理器里读取，命名一致；`chat/chat.js` 的 `PET_ID` 常量在 Task 5 里从 `params.get('pet')` 读取，和 dashboard.js（Task 3）生成的链接 `?pet=${pack.id}` 参数名对得上。
- **额外发现并修的一个问题**：原来的 `serveStatic` 只对根路径 `/` 做了 `index.html` 兜底，`/dashboard/`、`/playground/` 这种目录形式路径不会自动补 `index.html`——这在只服务 `chat/`/`pets/`/`pet-lib/` 时不会暴露，但这次要通过浏览器真实导航到这些目录路径，所以在 Task 2 里一起加了通用的"路径以 `/` 结尾就补 `index.html`"逻辑，并在验证步骤里专门测了这一点。

---

## 执行方式

Plan complete and saved to `docs/superpowers/plans/2026-09-02-dashboard-chat-integration.md`. 两种执行方式选一个：

1. **Subagent-Driven（推荐）**——每个 task 派一个全新子代理去做，任务间我来 review，迭代快
2. **Inline Execution**——在当前会话里按 executing-plans 批量跑，分批设检查点

你选哪个？
