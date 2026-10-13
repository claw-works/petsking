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
      corner: 'center', size: +(document.getElementById('rng-size') ? document.getElementById('rng-size').value : 520), draggable: true,
      ai: { enabled: true }, autoStart: true,
    });
    pet.on('action', ({ action, meta }) => log(`▶ ${action}` + (meta && meta.kind ? ` [${meta.kind}]` : '')));
    pet.on('state', ({ state }) => { document.getElementById('cur-state').textContent = 'state: ' + state; });
    pet.on('click', () => log('👆 click'));
    pet.setFacing(document.getElementById('sel-facing').value);
    log('已加载 ' + petId + ' / ' + renderer + ' / ' + driver);
    // 只记录没能出声的情况（被锁、冷却、无 TTS、已关闭等）
    pet.on('speech', ({ phase, text, reason, played }) => { if (phase === 'end' && played === false && reason) log('🔇 未出声: ' + reason + ' · ' + text); });
    renderFaceControls();
  } catch (e) {
    log('❌ 创建失败: ' + e.message);
    mount.innerHTML = '<div style="color:#ff9db0;padding:20px;font-size:13px">创建失败：' + e.message + '</div>';
  }
}

// —— 手动交互 / 空闲恢复 ——
// 点面板按钮 = 手动操作：暂停概率链，避免它在背后插动作；
// 空闲一段时间无操作，自动恢复概率链（自主陪伴）。
const IDLE_RESUME_MS = 15000;
let idleTimer = null;
// 只重置空闲计时（不停驱动）——用于状态机测试，保持状态机运转
function armIdleResume() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!pet) return;
    if (document.getElementById('sel-driver').value !== 'chain') {
      document.getElementById('sel-driver').value = 'chain';
      pet.setDriver('chain');
    } else if (pet.start) {
      pet.start();
    }
    log('⏱ 空闲 ' + (IDLE_RESUME_MS / 1000) + 's，恢复概率链');
  }, IDLE_RESUME_MS);
}
// 手动预览动作/表情/意图：暂停概率链 + 重置空闲计时
function manualHold() {
  if (!pet) return;
  if (pet.stop) pet.stop();
  armIdleResume();
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
    b.addEventListener('click', () => { if (pet) { manualHold(); pet.play(a, { loop: true }); log('预览: ' + a); } });
    grid.appendChild(b);
  });
}

// —— 序列测试：按顺序衔接播放多个动作（前面播完接下一个，最后一个循环）——
let seqToken = 0;
function stageVideos() {
  return [...mount.querySelectorAll('video')];
}
function frontVideo() {
  return stageVideos().find((v) => v.style.opacity === '1') || null;
}
function playSequence(names) {
  if (!pet || !names.length) return;
  manualHold();                    // 手动操作：暂停链 + 重置空闲计时
  const token = ++seqToken;        // 新序列使旧序列失效
  if (pet.stop) pet.stop();        // 暂停 chain，避免干扰
  let i = 0;
  const step = () => {
    if (token !== seqToken) return;
    const name = names[i];
    const isLast = i === names.length - 1;
    pet.play(name, { loop: isLast });
    log('序列: ' + name + (isLast ? '（循环）' : ''));
    if (isLast) return;            // 最后一个循环播放，序列结束
    // 等当前动作的前台视频播完，再接下一个
    setTimeout(() => {
      if (token !== seqToken) return;
      const v = frontVideo();
      if (!v) { i++; step(); return; }
      const onEnd = () => { v.removeEventListener('ended', onEnd); if (token === seqToken) { i++; step(); } };
      v.addEventListener('ended', onEnd);
      // 兜底：万一 ended 不触发（如已循环），用时长兜底
      const ms = (isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : 3000) + 100;
      setTimeout(() => { if (token === seqToken && !v.ended) { v.removeEventListener('ended', onEnd); i++; step(); } }, ms);
    }, 200);                       // 给渲染器交叉淡入 + loadeddata 一点时间
  };
  step();
}
function renderSeqPresets() {
  const row = document.getElementById('seq-presets');
  if (!row) return;
  const acts = Object.keys(manifest.actions || {});
  const presets = [];
  if (acts.includes('turn-right') && acts.includes('walk-right')) presets.push(['右转+走', ['turn-right', 'walk-right', 'idle']]);
  if (acts.includes('turn-left') && acts.includes('walk-left')) presets.push(['左转+走', ['turn-left', 'walk-left', 'idle']]);
  if (acts.includes('walk-left') && acts.includes('walk-right')) presets.push(['左右往返', ['walk-left', 'idle', 'walk-right', 'idle']]);
  row.innerHTML = '';
  presets.forEach(([label, seq]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { document.getElementById('seq-input').value = seq.join(', '); playSequence(seq); });
    row.appendChild(b);
  });
}

function renderEmotes() {
  const sec = document.getElementById('emote-section');
  const row = document.getElementById('emote-row');
  if (!sec || !row) return;
  const emotes = (manifest.emotes && manifest.emotes.actions) || {};
  const names = Object.keys(emotes);
  if (!names.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  row.innerHTML = '';
  names.forEach((a) => {
    const b = document.createElement('button');
    b.textContent = a;
    b.addEventListener('click', () => { if (pet && pet.emote) { manualHold(); pet.emote(a); log('表情: ' + a); } });
    row.appendChild(b);
  });
}

// 意图表演时的冒泡台词（残红人设：外冷内热、御姐）——仅 playground 演示用
const INTENT_SAY = {
  greet: '嗨，找我什么事？',
  happy: '嗯，心情不错。',
  celebrate: '哼哼，就知道会成功。',
  proud: '哼，这点小事罢了。',
  shy: '…别、别盯着我看。',
  sad: '……有点提不起劲。',
  angry: '再闹，可别怪我。',
  think: '让我想想…',
  dance: '别笑，这可是认真的。',
  sleep: '……有点困了，别吵我。',
  wave: '走了？下次再聊。',
  jump: '看我的！',
  surprised: '诶？什么情况！',
  love: '爱你哟。',
  tired: '有点困了呢…',
  wink: '接住了吗？',
};

function renderIntents() {
  const row = document.getElementById('intent-row');
  const map = (manifest.intentMap && Object.keys(manifest.intentMap).length) ? manifest.intentMap : DEFAULT_INTENT_MAP;
  row.innerHTML = '';
  Object.keys(map).forEach((i) => {
    const b = document.createElement('button');
    b.textContent = i;
    b.addEventListener('click', () => {
      if (!pet) return;
      manualHold();
      pet.react(i);
      if (INTENT_SAY[i]) pet.say(INTENT_SAY[i], 3000);
      log('意图: ' + i);
    });
    row.appendChild(b);
  });
}

// —— 表情 / 头部小动作 / 语音台词：按渲染器能力与素材包语音包显示 ——
function fillRow(sectionId, rowId, items, onClick) {
  const sec = document.getElementById(sectionId);
  const row = document.getElementById(rowId);
  row.innerHTML = '';
  sec.style.display = items.length ? '' : 'none';
  items.forEach(({ id, label, title }) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', () => onClick(id));
    row.appendChild(b);
  });
}

async function renderFaceControls() {
  if (!pet) return;
  const r = pet.renderer;
  const caps = (r && r.capabilities) || {};
  fillRow('expr-section', 'expr-row',
    caps.expression ? r.listExpressions().map((e) => ({ id: e.id, label: e.label })) : [],
    (id) => { manualHold(); pet.setExpression(id); log('表情: ' + id); });
  fillRow('gesture-section', 'gesture-row',
    caps.gesture ? [...r.listGestures().map((g) => ({ id: g, label: g })), { id: null, label: '清除' }] : [],
    (id) => { manualHold(); pet.setGesture(id); log('手势: ' + (id || '清除')); });
  const pack = await pet.voicePack();
  fillRow('voice-section', 'voice-row',
    pack ? pack.lines.map((l) => ({ id: l.id, label: l.label || l.id, title: l.text })) : [],
    async (id) => { const res = await pet.voice(id); log('语音: ' + id + (res.played ? '' : ' ✗ ' + res.reason)); });
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
  document.getElementById('btn-click').addEventListener('click', () => { if (pet) { manualHold(); pet.clickAction(); } });

  const seqPlay = document.getElementById('seq-play');
  if (seqPlay) seqPlay.addEventListener('click', () => {
    const raw = document.getElementById('seq-input').value.trim();
    if (!raw) return;
    const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const valid = names.filter((n) => (manifest.actions || {})[n]);
    if (!valid.length) { log('⚠ 序列里没有有效动作名'); return; }
    playSequence(valid);
  });

  document.querySelectorAll('[data-ev]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!pet) return;
      // 测试 Agent 事件：自动切到状态机（无需手动切），空闲后自动切回概率链
      if (document.getElementById('sel-driver').value !== 'statemachine') {
        document.getElementById('sel-driver').value = 'statemachine';
        await rebuild();
        log('↔ 自动切到 statemachine 驱动');
      }
      armIdleResume();   // 只重置空闲计时，不停状态机（否则 flash/sleep 转换会冻结）
      const ev = JSON.parse(btn.dataset.ev);
      pet.feed(ev); log('feed: ' + ev.type);
    });
  });

  const speakInput = document.getElementById('speak-input');
  const doSpeak = () => { if (pet && speakInput.value.trim()) { pet.speak(speakInput.value.trim()); log('说: ' + speakInput.value.trim()); } };
  document.getElementById('speak-btn').addEventListener('click', doSpeak);
  speakInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSpeak(); });
  document.getElementById('speak-stop').addEventListener('click', () => { if (pet) pet.stopSpeak(); });

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
  // 高瘦素材包（aspect < 1）：先把大小收到合适值，免得舞台高度超出视口
  const aspect = (manifest.geometry && manifest.geometry.aspect) || manifest.aspect;
  if (aspect && aspect < 1) {
    const rngSize = document.getElementById('rng-size');
    const v = Math.round(Math.min(520, 480 * aspect));
    rngSize.value = v;
    document.getElementById('size-val').textContent = rngSize.value + 'px';
  }
  bindControls();
  renderMeta();
  renderActionGrid();
  renderSeqPresets();
  renderEmotes();
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
