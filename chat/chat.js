// chat/chat.js — 聊天页：无 token 跳登录页，pet-lib 挂载 + WebSocket 聊天
import { createPet } from '../pet-lib/index.js';

const TOKEN_KEY = 'petsking_token';
const params = new URLSearchParams(location.search);
const PET_ID = params.get('pet') || 'blue-whale';

const petTitle = document.getElementById('pet-title');
const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

let pet = null;
let ws = null;
let assistantBubble = null;
// 整个页面生命周期内只要成功连过一次，就说明 token 是有效的——
// 之后哪怕重连一直失败（比如服务器还没重启完），也不该被当成"token 无效"跳登录页。
let everConnected = false;

function goToLogin() {
  localStorage.removeItem(TOKEN_KEY);
  location.href = 'login.html?pet=' + encodeURIComponent(PET_ID);
}

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
  petTitle.textContent = name;
}

async function loadHistory(token) {
  try {
    const res = await fetch(`/api/history?pet=${encodeURIComponent(PET_ID)}`, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return;
    const { messages } = await res.json();
    for (const m of messages) {
      if (m.role === 'user' || m.role === 'assistant') appendMessage(m.role, m.content);
    }
  } catch {
    // 拉历史失败不影响继续聊天，就当没有历史
  }
}

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
    size: 360,
    draggable: false,
    ai: { enabled: true },
    autoStart: true,
  });
}

function connectWs(token) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&pet=${encodeURIComponent(PET_ID)}`);

  ws.addEventListener('open', () => {
    everConnected = true;
  });

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
    assistantBubble = null;
    if (!everConnected) {
      // 这个页面从没连上过：token 或 pet 大概率是无效的，回登录页
      goToLogin();
      return;
    }
    // 曾经连上过：这次只是断线（服务器重启、网络抖动，甚至服务器还没重启完导致的重连失败），
    // 用同一个 token 一直自动重连，不登出
    appendMessage('assistant', '（连接断开，正在重连…）');
    setTimeout(() => connectWs(token), 1500);
  });
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  appendMessage('user', text);
  ws.send(JSON.stringify({ type: 'user_message', text }));
  chatInput.value = '';
});

async function start() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    goToLogin();
    return;
  }
  await loadPetName();
  await loadHistory(token);
  await mountPet();
  connectWs(token);
}

start();
