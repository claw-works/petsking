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
