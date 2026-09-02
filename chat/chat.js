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

  ws.addEventListener('close', goToLogin);
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
  await mountPet();
  connectWs(token);
}

start();
