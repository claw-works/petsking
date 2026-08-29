// dashboard.js — Instance 分类列表页
//
// 读 pets/index.json + 各 pet.json，把「素材包 × 它支持的每个渲染器」展开成一个个 instance，
// 按渲染方案分组展示。点卡片 → 跳 playground?pet=<id>&renderer=<r>。

const PETS_BASE = '../pets/';

// 渲染方案分组元信息（顺序即展示顺序）
const RENDERER_GROUPS = {
  webm:        { icon: '🎬', name: 'WebM 透明视频' },
  gif:         { icon: '🎞️', name: 'GIF' },
  spritesheet: { icon: '🧩', name: 'Sprite Sheet 逐帧' },
  pixel:       { icon: '🎨', name: '像素 Canvas' },
  svg:         { icon: '🦴', name: 'SVG 矢量骨骼' },
  three:       { icon: '🧊', name: 'Three.js 3D' },
};

async function main() {
  const groupsEl = document.getElementById('groups');
  let index;
  try {
    index = await (await fetch(PETS_BASE + 'index.json')).json();
  } catch (e) {
    groupsEl.textContent = '加载 pets/index.json 失败: ' + e.message;
    return;
  }

  // 拉每个包的 meta（描述）
  const packs = await Promise.all(index.pets.map(async (p) => {
    try {
      const m = await (await fetch(PETS_BASE + p.path)).json();
      return { ...p, meta: m.meta || {}, actions: Object.keys(m.actions || {}).length };
    } catch (e) { return { ...p, meta: {}, actions: 0 }; }
  }));

  // 展开成 instance：素材包 × 每个支持的渲染器，并按渲染器分桶
  const buckets = {};
  for (const pack of packs) {
    for (const r of (pack.renderers || [])) {
      (buckets[r] = buckets[r] || []).push(pack);
    }
  }

  // 按 RENDERER_GROUPS 顺序渲染分组
  for (const [r, info] of Object.entries(RENDERER_GROUPS)) {
    const list = buckets[r];
    if (!list || !list.length) continue;
    const group = document.createElement('div');
    group.className = 'group';
    group.innerHTML = `<h2>${info.icon} ${info.name} <span class="count">${list.length}</span></h2>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
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
    group.appendChild(grid);
    groupsEl.appendChild(group);
  }

  if (!groupsEl.childElementCount) groupsEl.textContent = '暂无 instance';
}

main();
