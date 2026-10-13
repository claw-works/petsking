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
