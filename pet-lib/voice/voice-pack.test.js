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

test('url：文件名逐段 encodeURIComponent（# 等也转义）', () => {
  const p = createVoicePack({ lines: [{ id: 'h', file: 'sub dir/a#1.mp3' }] }, '/v/');
  expect(p.url(p.get('h'))).toBe('/v/sub%20dir/a%231.mp3');
});

test('url：已编码的文件名不二次编码；非法 % 序列按原文编码', () => {
  const p = createVoicePack({ lines: [
    { id: 'enc', file: '%E4%BD%A0%E5%A5%BD.mp3' },
    { id: 'zh', file: '你好.mp3' },
    { id: 'bad', file: '100%.mp3' },
  ] }, '/v/');
  expect(p.url(p.get('enc'))).toBe('/v/%E4%BD%A0%E5%A5%BD.mp3');
  expect(p.url(p.get('zh'))).toBe('/v/%E4%BD%A0%E5%A5%BD.mp3');
  expect(p.url(p.get('bad'))).toBe('/v/100%25.mp3');
});

test('url：任意协议（file: app: blob: data: https:）原样返回', () => {
  const files = ['file:///x/a.mp3', 'app://pets/a.mp3', 'blob:abc', 'data:audio/mp3;base64,AA', 'HTTPS://x/a.mp3'];
  const p = createVoicePack({ lines: files.map((file, i) => ({ id: String(i), file })) }, '/v/');
  files.forEach((f, i) => expect(p.url(p.get(String(i)))).toBe(f));
});

test('url：缺 file → null', () => {
  const p = createVoicePack({ lines: [{ id: 'x', text: 'x' }] }, '/v/');
  expect(p.url(p.get('x'))).toBe(null);
  expect(p.url(null)).toBe(null);
});
