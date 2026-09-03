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

    if (url.pathname === '/api/history' && req.method === 'GET') {
      const auth = req.headers.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
      const petId = url.searchParams.get('pet');
      if (!token) return new Response('missing token', { status: 401 });
      if (!petId || !PET_REGISTRY.has(petId)) return new Response('unknown pet', { status: 400 });
      let userId;
      try {
        userId = await verifyToken(token, JWT_SECRET);
      } catch {
        return new Response('invalid token', { status: 401 });
      }
      const messages = conversations.listMessages(userId, petId, 50);
      return Response.json({ messages });
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
        console.error('[ws turn failed]', { userId: ws.data.userId, petId: ws.data.petId, name: e?.name, message: e?.message });
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      } finally {
        ws.data.turnInFlight = false;
      }
    },
  },
});

console.log(`petsking server listening on http://localhost:${PORT}`);
