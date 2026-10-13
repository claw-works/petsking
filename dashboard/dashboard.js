// dashboard.js — 宠物列表页
//
// 读 pets/index.json + 各 pet.json，把「素材包 × 它支持的每个渲染器」展开成一个个卡片，
// 按渲染方案分组展示，卡片用 avatar.webp 做头图。点卡片 → 跳 playground?pet=<id>&renderer=<r>。

const PETS_BASE = '../pets/';

// 渲染方案分组元信息（顺序即展示顺序）
const RENDERER_GROUPS = {
  gltf:        { icon: '🧍', name: 'GLTF 3D 角色' },
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
    group.innerHTML = `<h2><span class="icon">${info.icon}</span> ${info.name} <span class="count">${list.length}</span></h2>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const pack of list) {
      const card = document.createElement('div');
      card.className = 'card';
      const playgroundHref = `../playground/?pet=${encodeURIComponent(pack.id)}&renderer=${encodeURIComponent(r)}`;
      const chatHref = `../chat/index.html?pet=${encodeURIComponent(pack.id)}`;
      const canChat = pack.chat === true;
      const avatarUrl = `${PETS_BASE}${pack.id}/avatar.webp`;
      const displayName = pack.meta.name || pack.name || pack.id;
      card.innerHTML =
        `<a href="${playgroundHref}" class="avatar-wrap">` +
          `<img src="${avatarUrl}" alt="${displayName}" loading="lazy" ` +
            `onerror="this.remove();this.parentElement.querySelector('.fallback-ico').style.display='grid'" />` +
          `<span class="fallback-ico" style="display:none">${info.icon}</span>` +
          `<span class="rcorner">${r}</span>` +
        `</a>` +
        `<div class="body">` +
          `<h3>${displayName}</h3>` +
          `<p>${pack.meta.description || ''}</p>` +
          `<div class="rtags">${(pack.renderers || []).map((x) => `<span class="rtag">${x}</span>`).join('')}` +
          `<span class="rtag muted">${pack.actions} 动作</span></div>` +
          `<div class="card-actions">` +
            `<a class="primary" href="${playgroundHref}">🎭 展示</a>` +
            (canChat ? `<a href="${chatHref}">💬 互动</a>` : '') +
          `</div>` +
        `</div>`;
      grid.appendChild(card);
    }
    group.appendChild(grid);
    groupsEl.appendChild(group);
  }

  if (!groupsEl.childElementCount) groupsEl.textContent = '暂无宠物';
}

main();
