// 帧检查器：加载 webm，逐帧步进，显示帧号，标记 loopFrom/loopTo。
// 纯前端、零依赖，不上传/不修改原始文件。

const video = document.getElementById('src-video');
const canvas = document.getElementById('stage-canvas');
const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
const dropzone = document.getElementById('dropzone');
const canvasWrap = document.getElementById('canvas-wrap');
const emptyHint = document.getElementById('empty-hint');

const fileInput = document.getElementById('file-input');
const filePill = document.getElementById('file-pill');
const fileMeta = document.getElementById('file-meta');

const fpsInput = document.getElementById('fps-input');
const frameInput = document.getElementById('frame-input');
const frameSlider = document.getElementById('frame-slider');
const badgeFrame = document.getElementById('badge-frame');
const badgeTotal = document.getElementById('badge-total');
const badgeLoop = document.getElementById('badge-loop');
const loopMarkers = document.getElementById('loop-markers');

const btnFirst = document.getElementById('btn-first');
const btnPrev10 = document.getElementById('btn-prev10');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const btnNext10 = document.getElementById('btn-next10');
const btnLast = document.getElementById('btn-last');
const chkLoopPreview = document.getElementById('chk-loop-preview');

const loopFromInput = document.getElementById('loop-from');
const loopToInput = document.getElementById('loop-to');
const setFromBtn = document.getElementById('set-from');
const setToBtn = document.getElementById('set-to');
const gotoFromBtn = document.getElementById('goto-from');
const gotoToBtn = document.getElementById('goto-to');
const loopHint = document.getElementById('loop-hint');

const diffVsFromBtn = document.getElementById('diff-vs-from');
const diffHint = document.getElementById('diff-hint');

const actionNameInput = document.getElementById('action-name');
const actionFileInput = document.getElementById('action-file');
const codeOut = document.getElementById('code-out');
const copyBtn = document.getElementById('copy-btn');

let fps = 24;
let totalFrames = 0;
let duration = 0;
let curFrame = 0;
let isPlaying = false;
let playRAF = null;
let objectUrl = null;

// ---------- 文件加载 ----------

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

async function loadFile(file) {
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;

  filePill.textContent = file.name;
  fileMeta.innerHTML = `文件名：<b>${escapeHtml(file.name)}</b><br>大小：<b>${humanSize(file.size)}</b><br>加载中…`;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('视频加载失败，浏览器可能不支持该 webm 编码'));
  });

  duration = video.duration;
  fps = Math.max(1, Math.round(Number(fpsInput.value) || 24));
  totalFrames = Math.max(1, Math.round(duration * fps));

  fileMeta.innerHTML = `文件名：<b>${escapeHtml(file.name)}</b><br>` +
    `大小：<b>${humanSize(file.size)}</b><br>` +
    `分辨率：<b>${video.videoWidth}×${video.videoHeight}</b><br>` +
    `时长：<b>${duration.toFixed(3)}s</b><br>` +
    `按 FPS=${fps} 估算总帧数：<b>${totalFrames}</b>` +
    `<div class="hint" style="margin-top:6px">⚠️ 帧数为估算值（时长×FPS），若与实际封装帧数略有偏差，以肉眼逐帧核对姿态为准。</div>`;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  frameSlider.max = totalFrames - 1;
  frameSlider.disabled = false;
  frameInput.disabled = false;
  frameInput.max = totalFrames - 1;
  loopFromInput.disabled = false;
  loopToInput.disabled = false;
  loopFromInput.max = totalFrames - 1;
  loopToInput.max = totalFrames - 1;
  loopToInput.value = totalFrames - 1;

  [btnFirst, btnPrev10, btnPrev, btnPlay, btnNext, btnNext10, btnLast,
   chkLoopPreview, setFromBtn, setToBtn, gotoFromBtn, gotoToBtn, diffVsFromBtn]
    .forEach(el => el.disabled = false);

  emptyHint.style.display = 'none';
  canvasWrap.classList.add('show');

  await seekToFrame(0);
  updateLoopMarkers();
  updateCode();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------- Frame-accurate seek ----------
// video.currentTime 的精度取决于浏览器解码关键帧策略，这里用 fps 换算时间码，
// 并在 seeked 后用 requestVideoFrameCallback（若可用）二次确认再绘制，
// 尽量让"肉眼看到的画面"与"帧号"一致。

function frameToTime(frameIndex) {
  // 取帧区间中点，避开正好落在两帧边界导致取整误差
  const t = (frameIndex + 0.5) / fps;
  return Math.min(t, Math.max(0, duration - 1 / (fps * 2)));
}

function seekToFrame(frameIndex) {
  frameIndex = Math.max(0, Math.min(totalFrames - 1, Math.round(frameIndex)));
  return new Promise((resolve) => {
    curFrame = frameIndex;
    const time = frameToTime(frameIndex);

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      drawFrame();
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  badgeFrame.textContent = curFrame;
  badgeTotal.textContent = totalFrames - 1;
  frameSlider.value = curFrame;
  frameInput.value = curFrame;

  const from = Number(loopFromInput.value) || 0;
  const to = Number(loopToInput.value) || 0;
  if (curFrame === from) badgeLoop.textContent = '● loopFrom';
  else if (curFrame === to) badgeLoop.textContent = '● loopTo';
  else if (curFrame > from && curFrame < to) badgeLoop.textContent = '循环区间内';
  else badgeLoop.textContent = '';
}

// ---------- 播放控制 ----------
// 播放走原生 video.play()（真实速度，不是逐帧模拟），用 rAF 读 currentTime 换算帧号显示；
// 循环预览到 loopTo 时才手动 seek 回 loopFrom。与「单帧步进」（seekToFrame）是两套机制：
// 步进要精确到帧、可以慢；播放要接近真实速度，不能受逐帧 seek 的解码延迟拖慢。

function timeToFrame(t) {
  return Math.max(0, Math.min(totalFrames - 1, Math.round(t * fps)));
}

function stopPlay() {
  isPlaying = false;
  btnPlay.textContent = '▶';
  if (playRAF) { cancelAnimationFrame(playRAF); playRAF = null; }
  video.pause();
  video.onended = null;
}

function startPlay() {
  isPlaying = true;
  btnPlay.textContent = '⏸';
  video.playbackRate = 1;

  const useLoop = chkLoopPreview.checked;
  const from = Number(loopFromInput.value) || 0;
  const to = Number(loopToInput.value) || (totalFrames - 1);
  const loopToSec = frameToTime(to) - 0.5 / fps; // 还原成帧边界时间（frameToTime 取的是帧区间中点）
  const loopFromSec = frameToTime(from) - 0.5 / fps;

  if (useLoop) {
    video.currentTime = loopFromSec;
  }
  video.onended = () => { if (isPlaying && !useLoop) stopPlay(); };
  video.play().catch(() => {});

  const tick = () => {
    if (!isPlaying) return;
    curFrame = timeToFrame(video.currentTime);
    drawFrame();
    if (useLoop && video.currentTime >= loopToSec) {
      video.currentTime = loopFromSec;
    }
    playRAF = requestAnimationFrame(tick);
  };
  playRAF = requestAnimationFrame(tick);
}

btnPlay.addEventListener('click', () => { isPlaying ? stopPlay() : startPlay(); });

btnFirst.addEventListener('click', () => { stopPlay(); seekToFrame(0); });
btnLast.addEventListener('click', () => { stopPlay(); seekToFrame(totalFrames - 1); });
btnPrev.addEventListener('click', () => { stopPlay(); seekToFrame(curFrame - 1); });
btnNext.addEventListener('click', () => { stopPlay(); seekToFrame(curFrame + 1); });
btnPrev10.addEventListener('click', () => { stopPlay(); seekToFrame(curFrame - 10); });
btnNext10.addEventListener('click', () => { stopPlay(); seekToFrame(curFrame + 10); });

frameSlider.addEventListener('input', () => { stopPlay(); seekToFrame(Number(frameSlider.value)); });
frameInput.addEventListener('change', () => { stopPlay(); seekToFrame(Number(frameInput.value)); });

fpsInput.addEventListener('change', () => {
  const newFps = Math.max(1, Math.round(Number(fpsInput.value) || 24));
  if (!duration) { fps = newFps; return; }
  fps = newFps;
  totalFrames = Math.max(1, Math.round(duration * fps));
  frameSlider.max = totalFrames - 1;
  frameInput.max = totalFrames - 1;
  loopFromInput.max = totalFrames - 1;
  loopToInput.max = totalFrames - 1;
  seekToFrame(Math.min(curFrame, totalFrames - 1));
  updateLoopMarkers();
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!totalFrames) return;
  if (e.code === 'Space') { e.preventDefault(); isPlaying ? stopPlay() : startPlay(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); stopPlay(); seekToFrame(curFrame - (e.shiftKey ? 10 : 1)); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); stopPlay(); seekToFrame(curFrame + (e.shiftKey ? 10 : 1)); }
});

// ---------- 循环标记 ----------

function updateLoopMarkers() {
  const from = Number(loopFromInput.value) || 0;
  const to = Number(loopToInput.value) || 0;
  const pct = (n) => totalFrames > 1 ? (n / (totalFrames - 1)) * 100 : 0;
  const left = Math.min(pct(from), pct(to));
  const width = Math.abs(pct(to) - pct(from));
  loopMarkers.innerHTML = `<div class="seg" style="left:${left}%;width:${width}%"></div>`;

  if (from >= to) {
    loopHint.innerHTML = '<span class="badge-warn">⚠ loopFrom 应小于 loopTo</span>';
  } else {
    const frames = to - from;
    const secs = (frames / fps).toFixed(2);
    loopHint.innerHTML = `循环区间 <b>${frames}</b> 帧（${secs}s，@ ${fps}fps）。` +
      `<div class="hint" style="margin-top:4px">经验：不要选静止/直立站姿作循环端点，选步态/动作相位一致的两帧，避免回跳时「顿一下」（顺拐）。</div>`;
  }
  updateCode();
  drawFrame();
}

setFromBtn.addEventListener('click', () => { loopFromInput.value = curFrame; updateLoopMarkers(); });
setToBtn.addEventListener('click', () => { loopToInput.value = curFrame; updateLoopMarkers(); });
gotoFromBtn.addEventListener('click', () => { stopPlay(); seekToFrame(Number(loopFromInput.value) || 0); });
gotoToBtn.addEventListener('click', () => { stopPlay(); seekToFrame(Number(loopToInput.value) || 0); });
loopFromInput.addEventListener('change', updateLoopMarkers);
loopToInput.addEventListener('change', updateLoopMarkers);

// ---------- 相位差异对比 ----------
// 用当前帧与 loopFrom 帧做像素差异估算，辅助判断该帧是否适合做循环端点。
// 纯前端 canvas 像素采样，不依赖服务端。

async function captureSnapshotAt(frameIndex) {
  await seekToFrame(frameIndex);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function pixelDiff(a, b) {
  const da = a.data, db = b.data;
  let sum = 0;
  const len = Math.min(da.length, db.length);
  const step = 4 * 8; // 抽样步长，避免逐像素太慢
  let n = 0;
  for (let i = 0; i < len; i += step) {
    sum += Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
    n++;
  }
  return n ? sum / n / 3 : 0;
}

diffVsFromBtn.addEventListener('click', async () => {
  diffHint.textContent = '计算中…';
  const from = Number(loopFromInput.value) || 0;
  const targetFrame = curFrame; // 锁定目标帧号和恢复点，避免顺序 seek 过程中 curFrame 被改写后读错
  const snapA = await captureSnapshotAt(from);
  const snapB = await captureSnapshotAt(targetFrame);
  await seekToFrame(targetFrame); // 恢复到用户原本停留的帧
  const diff = pixelDiff(snapA, snapB);
  const level = diff < 8 ? 'badge-ok' : diff < 16 ? '' : 'badge-warn';
  diffHint.innerHTML = `帧 ${from} 与帧 ${targetFrame} 的平均像素差异：<span class="${level}">${diff.toFixed(2)}</span>` +
    `<div class="hint" style="margin-top:4px">数值越小说明姿态相位越接近，&lt;8 通常可作循环端点候选；仅供参考，仍需肉眼确认。</div>`;
});

// ---------- pet.json 代码片段 ----------

function updateCode() {
  const name = actionNameInput.value.trim() || 'action-name';
  const file = actionFileInput.value.trim() || 'action.webm';
  const from = Number(loopFromInput.value) || 0;
  const to = Number(loopToInput.value) || 0;
  const snippet = {
    [name]: { file, loop: true, loopFrom: from, loopTo: to }
  };
  codeOut.textContent = JSON.stringify(snippet, null, 2);
}

actionNameInput.addEventListener('input', updateCode);
actionFileInput.addEventListener('input', updateCode);

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(codeOut.textContent);
    copyBtn.textContent = '✅ 已复制';
    setTimeout(() => copyBtn.textContent = '📋 复制到剪贴板', 1200);
  } catch {
    copyBtn.textContent = '复制失败，请手动选中';
    setTimeout(() => copyBtn.textContent = '📋 复制到剪贴板', 1500);
  }
});

// ---------- 文件选择 / 拖放 ----------

fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) loadFile(file);
});

['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});
