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

const existingToken = localStorage.getItem(TOKEN_KEY);
if (existingToken) startChat(existingToken);
