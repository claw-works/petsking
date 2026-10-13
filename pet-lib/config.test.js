// pet-lib/config.test.js
import { test, expect } from 'bun:test';
import { loadAssetPack, mergeConfig } from './config.js';

test('gltf 字段透传到 assets，voices 解析为相对 assetsDir 的 URL', async () => {
  const manifest = {
    id: 'q', renderer: 'gltf', model: 'model.glb', camera: 'bust', turnDeg: 60, shadow: false,
    expressions: { calm: { morphs: {} } }, gestureBones: { head: 'H' }, voices: 'voices/index.json',
    actions: { idle: 'Stand2' },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => manifest });
  try {
    const pack = await loadAssetPack('q', '/pets/');
    expect(pack.assets.model).toBe('model.glb');
    expect(pack.assets.camera).toBe('bust');
    expect(pack.assets.turnDeg).toBe(60);
    expect(pack.assets.shadow).toBe(false);
    expect(pack.assets.expressions).toEqual({ calm: { morphs: {} } });
    expect(pack.assets.gestureBones).toEqual({ head: 'H' });
    expect(pack.voices).toBe('/pets/q/assets/voices/index.json');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('没有 voices 时 pack.voices 为 null', async () => {
  const pack = await loadAssetPack({ id: 'x', actions: {} });
  expect(pack.voices).toBe(null);
});

test('mergeConfig 合并 voice 配置', () => {
  const c = mergeConfig({ voice: { cooldownMs: 1000 } });
  expect(c.voice).toEqual({ enabled: true, cooldownMs: 1000, lang: 'zh-CN' });
  expect(mergeConfig({}).voice.enabled).toBe(true);
});

test('voices：任意协议 / 开头原样使用，相对路径接 assets.baseUrl', async () => {
  for (const abs of ['https://x/v.json', 'blob:abc', 'data:application/json,{}', 'app://pets/v.json', '/v/index.json']) {
    const pack = await loadAssetPack({ id: 'x', baseUrl: '/p/', voices: abs });
    expect(pack.voices).toBe(abs);
  }
  const rel = await loadAssetPack({ id: 'x', baseUrl: '/p/', voices: 'voices/index.json' });
  expect(rel.voices).toBe('/p/assets/voices/index.json');
});

test('voices 不是字符串 → 警告并置 null', async () => {
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  try {
    const pack = await loadAssetPack({ id: 'x', voices: { url: 'a.json' } });
    expect(pack.voices).toBe(null);
    expect(warned).toBe(1);
  } finally { console.warn = warn; }
});

test('aspect 透传到 assets', async () => {
  const pack = await loadAssetPack({ id: 'x', aspect: 0.5, actions: {} });
  expect(pack.assets.aspect).toBe(0.5);
});
