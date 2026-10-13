// pet-lib/voice/voice.test.js — Voice 调度：打断、provider 契约、口型收尾
import { test, expect, beforeEach, afterEach } from 'bun:test';
import { Voice } from './voice.js';
import { browserTts } from './tts.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const GLOBALS = ['window', 'requestAnimationFrame', 'cancelAnimationFrame', 'speechSynthesis', 'SpeechSynthesisUtterance'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});

afterEach(() => {
  for (const k of GLOBALS) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});

/** 假 lipsync：play 返回可控 promise；stop() 结束所有在播的（与真 AudioLipSync 语义一致） */
function fakeLipsync() {
  const ls = {
    unlocked: true,
    plays: [],
    stops: 0,
    unlock() {},
    play(src) {
      let resolve;
      const p = new Promise((r) => { resolve = r; });
      ls.plays.push({ src, resolve });
      return p;
    },
    stop() { ls.stops++; for (const pl of ls.plays) pl.resolve(); },
    sample: () => ({ open: 0.5, wide: 0, round: 0 }),
  };
  return ls;
}

function mouthLog() {
  const calls = [];
  return { calls, setMouth: (m) => calls.push(m), last: () => calls[calls.length - 1] };
}

/** 装一个假的浏览器 speechSynthesis，记录 cancel/speak 顺序 */
function installSpeech() {
  const log = [];
  const utterances = [];
  globalThis.window = globalThis;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; utterances.push(this); } };
  globalThis.speechSynthesis = {
    speak: (u) => log.push('speak:' + u.text),
    cancel: () => log.push('cancel'),
  };
  return { log, utterances };
}

test('browserTts：Voice 先取消旧的再 speak，说话期间不会自己 cancel，onend 后才结束', async () => {
  const { log, utterances } = installSpeech();
  const m = mouthLog();
  const v = new Voice({ setMouth: m.setMouth, tts: browserTts, lipsync: fakeLipsync() });
  let settled = false;
  const p = v.speakText('你好呀').then((r) => { settled = true; return r; });
  await tick(30);
  const speakAt = log.indexOf('speak:你好呀');
  expect(speakAt).toBeGreaterThan(0);
  expect(log.slice(0, speakAt).every((e) => e === 'cancel')).toBe(true);
  expect(log.slice(speakAt + 1)).toEqual([]);            // speak 之后没有任何 cancel
  expect(settled).toBe(false);                           // 还在说，没提前结束
  expect(m.calls.some((f) => f && f.viseme)).toBe(true); // 嘴在动
  utterances[0].onend();
  expect(await p).toEqual({ played: true, interrupted: false });
  expect(log.slice(speakAt + 1)).toEqual([]);
  expect(m.last()).toBe(null);
});

test('{done} provider：rAF 不跑（隐藏标签页）也由 done 驱动结束', async () => {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  let finish;
  const v = new Voice({ tts: async () => ({ done: new Promise((r) => { finish = r; }) }), lipsync: fakeLipsync() });
  const p = v.speakText('嗯');
  await tick();
  finish();
  expect(await p).toEqual({ played: true, interrupted: false });
});

test('{done} provider：口型时间线跑完会循环，直到 done', async () => {
  let finish;
  const m = mouthLog();
  const v = new Voice({ setMouth: m.setMouth, tts: async () => ({ done: new Promise((r) => { finish = r; }) }), lipsync: fakeLipsync() });
  const p = v.speakText('啊');   // 时间线约 0.43~0.48s
  await tick(700);
  expect(m.last()).not.toBe(null);
  expect(m.last().viseme).toBeDefined();
  finish();
  await p;
  expect(m.last()).toBe(null);
});

test('{done} provider：done 永不落定时 stop() 也能让 speakText 结束', async () => {
  const v = new Voice({ tts: async () => ({ done: new Promise(() => {}) }), lipsync: fakeLipsync() });
  const p = v.speakText('嗯');
  await tick();
  v.stop();
  expect(await p).toEqual({ played: false, interrupted: true });
});

test('慢 TTS 请求期间 stop() → interrupted，且不再播放', async () => {
  let answer;
  const ls = fakeLipsync();
  const v = new Voice({ tts: () => new Promise((r) => { answer = r; }), lipsync: ls });
  const p = v.speakText('你好');
  await tick();
  v.stop();
  answer(new ArrayBuffer(8));
  expect(await p).toEqual({ played: false, interrupted: true });
  expect(ls.plays.length).toBe(0);
});

test('provider 返回 null → no-tts，不动嘴', async () => {
  const m = mouthLog();
  const v = new Voice({ setMouth: m.setMouth, tts: async () => null, lipsync: fakeLipsync() });
  expect(await v.speakText('你好')).toEqual({ played: false, reason: 'no-tts' });
  await tick(10);
  expect(m.calls.every((f) => f === null)).toBe(true);
});

test('provider 抛错 → tts-error', async () => {
  const v = new Voice({ tts: async () => { throw new Error('boom'); }, lipsync: fakeLipsync() });
  const warn = console.warn; console.warn = () => {};
  try { expect(await v.speakText('x')).toEqual({ played: false, reason: 'tts-error' }); }
  finally { console.warn = warn; }
});

test('音频 provider：lipsync.play 只调一次，结束时 setMouth(null)', async () => {
  const ls = fakeLipsync();
  const m = mouthLog();
  const buf = new ArrayBuffer(8);
  const v = new Voice({ setMouth: m.setMouth, tts: async () => buf, lipsync: ls });
  const p = v.speakText('你好');
  await tick(20);
  expect(ls.plays.length).toBe(1);
  expect(ls.plays[0].src).toBe(buf);
  expect(m.calls.some((f) => f && f.open === 0.5)).toBe(true);
  ls.plays[0].resolve();
  expect(await p).toEqual({ played: true, interrupted: false });
  expect(m.last()).toBe(null);
});

test('被取代的 playAudio 不会把新一段的嘴关掉', async () => {
  const ls = fakeLipsync();
  const m = mouthLog();
  const v = new Voice({ setMouth: m.setMouth, lipsync: ls });
  const p1 = v.playAudio('a.mp3');
  await tick(5);
  const p2 = v.playAudio('b.mp3');
  expect(await p1).toEqual({ played: true, interrupted: true });
  const mark = m.calls.length;
  await tick(20);
  expect(m.calls.slice(mark).length).toBeGreaterThan(0);
  expect(m.calls.slice(mark).every((f) => f !== null)).toBe(true);   // 新一段的泵还在推口型
  ls.plays[1].resolve();
  expect(await p2).toEqual({ played: true, interrupted: false });
  expect(m.last()).toBe(null);
});

test('lipsync 抛 code=locked → reason locked', async () => {
  const ls = fakeLipsync();
  ls.play = async () => { const e = new Error('x'); e.code = 'locked'; throw e; };
  const v = new Voice({ lipsync: ls });
  expect(await v.playAudio('a.mp3')).toEqual({ played: false, reason: 'locked' });
});

test('未解锁 → locked，不调 provider', async () => {
  const ls = fakeLipsync();
  ls.unlocked = false;
  let called = false;
  const v = new Voice({ tts: async () => { called = true; return null; }, lipsync: ls });
  expect(await v.speakText('x')).toEqual({ played: false, reason: 'locked' });
  expect(await v.playAudio('a')).toEqual({ played: false, reason: 'locked' });
  expect(called).toBe(false);
});

test('{done} 为 rejected promise → tts-error，且没有未处理的 rejection', async () => {
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const v = new Voice({ tts: async () => ({ done: Promise.reject(new Error('boom')) }), lipsync: fakeLipsync() });
    expect(await v.speakText('嗯')).toEqual({ played: false, reason: 'tts-error' });
    await tick(20);
    expect(unhandled).toEqual([]);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('新的 speakText 打断自出声的旧段：旧段 interrupted、调用旧 cancel、新段口型不被旧段清空', async () => {
  const m = mouthLog();
  let cancelled = 0;
  const finishes = [];
  const tts = async () => {
    const i = finishes.length;
    let finish;
    const done = new Promise((r) => { finish = r; });
    finishes.push(finish);
    return i === 0 ? { done, cancel: () => { cancelled++; } } : { done };
  };
  const v = new Voice({ setMouth: m.setMouth, tts, lipsync: fakeLipsync() });
  const p1 = v.speakText('第一句');
  await tick(10);
  const p2 = v.speakText('第二句');
  expect(await p1).toEqual({ played: false, interrupted: true });
  expect(cancelled).toBe(1);
  const mark = m.calls.length;
  await tick(30);
  expect(m.calls.slice(mark).length).toBeGreaterThan(0);
  expect(m.calls.slice(mark).every((f) => f !== null)).toBe(true);
  finishes[1]();
  expect(await p2).toEqual({ played: true, interrupted: false });
  expect(m.last()).toBe(null);
  expect(cancelled).toBe(1);   // 新段正常结束不会再触发旧的 cancel
});

test('playAudio(null/undefined) → no-src，且不打断正在说的', async () => {
  const ls = fakeLipsync();
  const v = new Voice({ lipsync: ls });
  const p = v.playAudio('a.mp3');
  await tick(5);
  const stops = ls.stops;
  expect(await v.playAudio(null)).toEqual({ played: false, reason: 'no-src' });
  expect(await v.playAudio(undefined)).toEqual({ played: false, reason: 'no-src' });
  expect(ls.stops).toBe(stops);
  ls.plays[0].resolve();
  expect(await p).toEqual({ played: true, interrupted: false });
});
