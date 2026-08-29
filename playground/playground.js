// playground.js — 具体宠物预览 & 调试台
//
// 从 URL 读 ?pet=<id>&renderer=<r>&driver=<d>，用 pet-lib 的 createPet 加载指定宠物，
// 提供切驱动/渲染器/朝向、点动作预览、喂 Agent 事件、意图表演、日志。

import { createPet, DEFAULT_INTENT_MAP } from '../pet-lib/index.js';

const PETS_BASE = '../pets/';
const params = new URLSearchParams(location.search);
const petId = params.get('pet') || 'blue-whale';
const initRenderer = params.get('renderer');
const initDriver = params.get('driver') || 'chain';

const mount = document.getElementById('pet-mount');
const logEl = document.getElementById('log');
let pet = null;
let manifest = null;

function log(msg) {
  const row = document.createElement('div');
  row.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg;
  logEl.insertBefore(row, logEl.firstChild);
  while (logEl.childElementCount > 40) logEl.removeChild(logEl.lastChild);
}

async function fetchManifest() {
  const res = await fetch(PETS_BASE + petId + '/pet.json');
  if (!res.ok) throw new Error('pet.json HTTP ' + res.status);
  return res.json();
}

async function rebuild() {
  if (pet) { pet.destroy(); pet = null; }
  mount.innerHTML = '';
  const driver = document.getElementById('sel-driver').value;
  const renderer = document.getElementById('sel-renderer').value || manifest.renderer;
  try {
    pet = await createPet({
      pet: petId, petsBaseUrl: PETS_BASE,
      renderer, driver, container: mount,
      corner: 'center', size: +(document.getElementById('rng-size') ? document.getElementById('rng-size').value : 260), draggable: true,
      ai: { enabled: true }, autoStart: true,
    });
    pet.on('action', ({ action, meta }) => log(`▶ ${action}` + (meta && meta.kind ? ` [${meta.kind}]` : '')));
    pet.on('state', ({ state }) => { document.getElementById('cur-state').textContent = 'state: ' + state; });
    pet.on('click', () => log('👆 click'));
    pet.setFacing(document.getElementById('sel-facing').value);
    log('已加载 ' + petId + ' / ' + renderer + ' / ' + driver);
  } catch (e) {
    log('❌ 创建失败: ' + e.message);
    mount.innerHTML = '<div style="color:#ff9db0;padding:20px;font-size:13px">创建失败：' + e.message + '</div>';
  }
}

function renderMeta() {
  const m = manifest.meta || {};
  const actions = Object.keys(manifest.actions || {});
  document.getElementById('pet-title').textContent = m.name || manifest.id;
  document.getElementById('pet-meta').innerHTML =
    `<b>${m.name || manifest.id}</b><br>${m.description || ''}<br>` +
    `渲染器 <span class="pill">${(manifest.renderers || [manifest.renderer]).join(' / ')}</span> · 动作 ${actions.length} 个`;
}

function renderActionGrid() {
  const grid = document.getElementById('action-grid');
  grid.innerHTML = '';
  Object.keys(manifest.actions || {}).forEach((a) => {
    const b = document.createElement('button');
    b.textContent = a;
    b.addEventListener('click', () => { if (pet) { pet.play(a, { loop: true }); log('预览: ' + a); } });
    grid.appendChild(b);
  });
}

function renderIntents() {
  const row = document.getElementById('intent-row');
  row.innerHTML = '';
  Object.keys(manifest.intentMap || DEFAULT_INTENT_MAP).forEach((i) => {
    const b = document.createElement('button');
    b.textContent = i;
    b.addEventListener('click', () => { if (pet) { pet.react(i); log('意图: ' + i); } });
    row.appendChild(b);
  });
}

function bindControls() {
  const sel = document.getElementById('sel-renderer');
  // 只列该 pet 支持的渲染器
  const supported = manifest.renderers || [manifest.renderer];
  supported.forEach((r) => { const o = document.createElement('option'); o.value = r; o.textContent = r; sel.appendChild(o); });
  sel.value = initRenderer && supported.includes(initRenderer) ? initRenderer : manifest.renderer;
  document.getElementById('sel-driver').value = initDriver;

  document.getElementById('sel-driver').addEventListener('change', rebuild);
  document.getElementById('sel-renderer').addEventListener('change', rebuild);
  document.getElementById('sel-facing').addEventListener('change', (e) => { if (pet) pet.setFacing(e.target.value); });
  document.getElementById('btn-click').addEventListener('click', () => { if (pet) pet.clickAction(); });

  document.querySelectorAll('[data-ev]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!pet) return;
      if (document.getElementById('sel-driver').value !== 'statemachine') { log('⚠ 请先切到 statemachine 驱动'); return; }
      const ev = JSON.parse(btn.dataset.ev);
      pet.feed(ev); log('feed: ' + ev.type);
    });
  });

  bindViewControls();
}

// —— 视图控件：大小 / 背景 / 对话泡泡 ——
function bindViewControls() {
  const stageTop = document.getElementById('stage-top');
  const rng = document.getElementById('rng-size');
  const sizeVal = document.getElementById('size-val');
  const selBg = document.getElementById('sel-bg');
  const bgColor = document.getElementById('bg-color');
  const chkBubble = document.getElementById('chk-bubble');
  const chatMock = document.getElementById('chat-mock');

  // 初始背景
  const applyBg = () => {
    stageTop.classList.remove('bg-checker', 'bg-solid', 'bg-desktop', 'bg-chat');
    stageTop.classList.add('bg-' + selBg.value);
    if (selBg.value === 'solid') stageTop.style.setProperty('--stage-bg', bgColor.value);
    bgColor.style.display = selBg.value === 'solid' ? '' : 'none';
    // 泡泡随背景明暗适配：chat 背景 或 纯色选了浅色 → on-light
    const light = selBg.value === 'chat' || (selBg.value === 'solid' && isLight(bgColor.value));
    chatMock.classList.toggle('on-light', light);
  };
  stageTop.classList.add('bg-checker');
  bgColor.style.display = 'none';

  // 大小
  rng.addEventListener('input', () => {
    sizeVal.textContent = rng.value + 'px';
    if (pet) pet.setSize(+rng.value);
  });

  selBg.addEventListener('change', applyBg);
  bgColor.addEventListener('input', () => { if (selBg.value === 'solid') { stageTop.style.setProperty('--stage-bg', bgColor.value); applyBg(); } });
  chkBubble.addEventListener('change', () => { chatMock.style.display = chkBubble.checked ? 'flex' : 'none'; });
}

async function main() {
  try { manifest = await fetchManifest(); }
  catch (e) { log('❌ ' + e.message); return; }
  bindControls();
  renderMeta();
  renderActionGrid();
  renderIntents();
  await rebuild();
}

// 判断十六进制颜色是否偏亮（用感知亮度阈值）
function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

main();
