// pet-lib/voice/voice-pack.test.js
import { test, expect } from 'bun:test';
import { createVoicePack, loadVoicePack } from './voice-pack.js';

const DATA = { lines: [
  { id: 'hello', text: '你来了，我一直在。', label: '你好', expression: 'smile', file: 'hello.mp3' },
  { id: 'abs', text: 'x', file: '/cdn/x.mp3' },
] };

test('get 按 id 取台词，未知 id → null', () => {
  const p = createVoicePack(DATA, '/pets/qingxiao/assets/voices/');
  expect(p.get('hello').text).toBe('你来了，我一直在。');
  expect(p.get('nope')).toBe(null);
  expect(p.lines.length).toBe(2);
});

test('url：相对路径拼 baseUrl，绝对路径原样', () => {
  const p = createVoicePack(DATA, '/pets/qingxiao/assets/voices/');
  expect(p.url(p.get('hello'))).toBe('/pets/qingxiao/assets/voices/hello.mp3');
  expect(p.url(p.get('abs'))).toBe('/cdn/x.mp3');
});

test('loadVoicePack 以 index.json 所在目录为 baseUrl', async () => {
  const fakeFetch = async (url) => ({ ok: true, json: async () => DATA, url });
  const p = await loadVoicePack('../pets/qingxiao/assets/voices/index.json', fakeFetch);
  expect(p.url(p.get('hello'))).toBe('../pets/qingxiao/assets/voices/hello.mp3');
});

test('loadVoicePack HTTP 失败抛错', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await expect(loadVoicePack('/x/index.json', fakeFetch)).rejects.toThrow('HTTP 404');
});

test('数据缺 lines 时为空包', () => {
  expect(createVoicePack({}, '/').lines).toEqual([]);
});
