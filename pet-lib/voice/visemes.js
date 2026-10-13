// pet-lib/voice/visemes.js — 口型（viseme）表 + 按字估算口型时间线（纯函数）
//
// 用在拿不到音频数据的场合（如浏览器 TTS 自己出声）：按字符粗略排一条口型时间线。
// 有音频数据时走 lipsync（mouth-features.js），更准。
// VISEMES 的 morph 名对应清霄 GLB 的嘴型 morph：Aa E I O U M_OpenSmall。

export const VISEMES = {
  rest: {},
  A: { Aa: 0.85 },
  E: { E: 0.7 },
  I: { I: 0.7 },
  O: { O: 0.8 },
  U: { U: 0.8 },
  M: { M_OpenSmall: 0.15 },           // 闭唇辅音 m/b/p
  S: { M_OpenSmall: 0.35, E: 0.25 },  // s/z/c
  N: { M_OpenSmall: 0.4, Aa: 0.2 },
  F: { M_OpenSmall: 0.3 },
};

const HAN_VOWELS = ['A', 'E', 'I', 'O', 'U'];
const PUNCT_RE = /[\s\p{P}\p{S}]/u;

export function charToViseme(ch) {
  if (/\p{Script=Han}/u.test(ch)) return HAN_VOWELS[ch.codePointAt(0) % HAN_VOWELS.length];
  const c = ch.toLowerCase();
  if ('aàáâä'.includes(c)) return 'A';
  if ('eèéêë'.includes(c)) return 'E';
  if ('iìíîïy'.includes(c)) return 'I';
  if ('oòóôö'.includes(c)) return 'O';
  if ('uùúûüw'.includes(c)) return 'U';
  if ('mbp'.includes(c)) return 'M';
  if ('szcxj'.includes(c)) return 'S';
  if ('nrltd'.includes(c)) return 'N';
  if ('fv'.includes(c)) return 'F';
  if (PUNCT_RE.test(ch)) return 'rest';
  return 'N';
}

/** 每字 75~125ms（空格/标点 120ms），末尾补 0.15s 后一段 rest。rand 可注入便于测试。 */
export function textToVisemeTimeline(text, rand = Math.random) {
  const events = [];
  let t = 0;
  for (const ch of [...(text || '')]) {
    const viseme = charToViseme(ch);
    const dur = viseme === 'rest' ? 0.12 : 0.075 + rand() * 0.05;
    events.push({ t, viseme, dur });
    t += dur;
  }
  if (!events.length) return { events, duration: 0 };
  events.push({ t: t + 0.15, viseme: 'rest', dur: 0.2 });
  return { events, duration: t + 0.35 };
}

export function visemeAt(timeline, time) {
  for (const ev of timeline.events) if (time >= ev.t && time < ev.t + ev.dur) return ev.viseme;
  return 'rest';
}
