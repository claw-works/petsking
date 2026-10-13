// pet-lib/voice/lipsync.test.js — AudioLipSync 的打断/挂起/缓存逻辑（假 AudioContext）
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { AudioLipSync } from './lipsync.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const GLOBALS = ['window', 'AudioContext', 'fetch'];
let saved;
let ctxOpts;   // 每个测试可调：{ state, resumeTo, decodeDelay, duration, autoEnd }

class FakeCtx {
  constructor() {
    this.state = ctxOpts.state ?? 'running';
    this.sampleRate = 48000;
    this.destination = {};
    this.nodes = [];
    this.decoded = [];
  }
  resume() {
    if (ctxOpts.resumeTo === 'pending') return new Promise(() => {});
    if (ctxOpts.resumeTo === 'reject') return Promise.reject(new Error('nope'));
    if (ctxOpts.resumeTo) this.state = ctxOpts.resumeTo;
    return Promise.resolve();
  }
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 8, connect() {} }; }
  decodeAudioData(buf) {
    this.decoded.push(buf);
    const delay = Array.isArray(ctxOpts.decodeDelay) ? ctxOpts.decodeDelay.shift() : (ctxOpts.decodeDelay || 0);
    return new Promise((r) => setTimeout(() => r({ duration: ctxOpts.duration ?? 10, tag: buf.byteLength }), delay));
  }
  createBufferSource() {
    const node = {
      started: false, stopped: false, onended: null,
      connect() {},
      start() { node.started = true; if (ctxOpts.autoEnd != null) setTimeout(() => node.onended?.(), ctxOpts.autoEnd); },
      stop() { node.stopped = true; setTimeout(() => node.onended?.(), 0); },
    };
    this.nodes.push(node);
    return node;
  }
}

beforeEach(() => {
  saved = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  ctxOpts = {};
  globalThis.window = globalThis;
  globalThis.AudioContext = FakeCtx;
});

afterEach(() => {
  for (const k of GLOBALS) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});

test('慢加载的旧 play 被新 play 取代：旧的 resolve 且不会停掉新的', async () => {
  ctxOpts.decodeDelay = [50, 0];   // 第一段解码慢，第二段快
  const ls = new AudioLipSync();
  let oldDone = false;
  const p1 = ls.play(new ArrayBuffer(1)).then(() => { oldDone = true; });
  const p2 = ls.play(new ArrayBuffer(2));
  await tick(10);
  const ctx = ls.ctx;
  expect(ctx.nodes.length).toBe(1);   // 新的已在播
  const newer = ctx.nodes[0];
  expect(newer.buffer.tag).toBe(2);
  await p1;                           // 旧的解码完成后直接 resolve
  expect(oldDone).toBe(true);
  expect(ctx.nodes.length).toBe(1);   // 旧的没有开播
  expect(newer.stopped).toBe(false);  // 也没停掉新的
  expect(ls.playing).toBe(true);
  ls.stop();
  await p2;
});

test('加载期间 stop() → play resolve，不开播', async () => {
  ctxOpts.decodeDelay = 30;
  const ls = new AudioLipSync();
  const p = ls.play(new ArrayBuffer(1));
  await tick(5);
  ls.stop();
  await p;
  expect(ls.ctx.nodes.length).toBe(0);
});

test('播放中 stop() 立刻 resolve', async () => {
  const ls = new AudioLipSync();
  const p = ls.play(new ArrayBuffer(1));
  await tick(5);
  expect(ls.playing).toBe(true);
  ls.stop();
  await p;
  expect(ls.playing).toBe(false);
});

test('onended 正常结束', async () => {
  ctxOpts.autoEnd = 5;
  const ls = new AudioLipSync();
  await ls.play(new ArrayBuffer(1));
  expect(ls.playing).toBe(false);
});

test('onended 永不触发 → 时长 + 500ms 兜底结束', async () => {
  ctxOpts.duration = 0.05;
  const ls = new AudioLipSync();
  const t0 = performance.now();
  await ls.play(new ArrayBuffer(1));
  const dt = performance.now() - t0;
  expect(dt).toBeGreaterThanOrEqual(500);
  expect(dt).toBeLessThan(1500);
});

test('挂起的 AudioContext 能 resume 就照常播', async () => {
  ctxOpts.state = 'suspended';
  ctxOpts.resumeTo = 'running';
  ctxOpts.autoEnd = 5;
  const ls = new AudioLipSync();
  await ls.play(new ArrayBuffer(1));
  expect(ls.ctx.nodes.length).toBe(1);
});

test('resume 被拒 → 抛 code=locked', async () => {
  ctxOpts.state = 'suspended';
  ctxOpts.resumeTo = 'reject';
  const ls = new AudioLipSync();
  const err = await ls.play(new ArrayBuffer(1)).catch((e) => e);
  expect(err.code).toBe('locked');
  expect(ls.ctx.nodes.length).toBe(0);
});

test('resume 一直 pending → 超时后抛 code=locked，不会卡死', async () => {
  ctxOpts.state = 'interrupted';
  ctxOpts.resumeTo = 'pending';
  const ls = new AudioLipSync();
  const err = await ls.play(new ArrayBuffer(1)).catch((e) => e);
  expect(err.code).toBe('locked');
});

test('load：TypedArray 只复制自己那段字节', async () => {
  const ls = new AudioLipSync();
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
  await ls.load(backing.subarray(2, 5));
  const got = ls.ctx.decoded[0];
  expect(got).toBeInstanceOf(ArrayBuffer);
  expect([...new Uint8Array(got)]).toEqual([1, 2, 3]);
  expect(got).not.toBe(backing.buffer);
});

test('load：普通 URL 缓存，blob:/data: 不缓存', async () => {
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };
  const ls = new AudioLipSync();
  await ls.load('/a.mp3');
  await ls.load('/a.mp3');
  expect(fetches).toBe(1);
  await ls.load('blob:x');
  await ls.load('blob:x');
  await ls.load('data:audio/mp3;base64,AA');
  expect(fetches).toBe(4);
  expect([...ls.cache.keys()]).toEqual(['/a.mp3']);
});

test('close：停掉正在播的、关闭 AudioContext 并置空', async () => {
  const ls = new AudioLipSync();
  ls.unlock();
  const ctx = ls.ctx;
  let closed = 0;
  ctx.close = () => { closed++; return Promise.resolve(); };
  const p = ls.play(new ArrayBuffer(4));
  await tick(5);
  expect(ls.playing).toBe(true);
  ls.close();
  await p;   // 正在播的那段立即结束
  expect(ls.playing).toBe(false);
  expect(closed).toBe(1);
  expect(ls.ctx).toBe(null);
  ls.close();   // 重复调用无副作用
  expect(closed).toBe(1);
});
