// pet-lib/voice/voice.js — 语音调度：同一时刻只说一段，新的打断旧的；逐帧把口型推给渲染器
//
//   playAudio(src)   播音频（URL/Blob/ArrayBuffer/TypedArray），音频驱动口型
//   speakText(text)  调 TTS provider（契约见 tts.js）：
//                      返回音频 → 走音频播放；返回 { done, cancel? } → 循环按字估算口型直到 done，stop() 时调 cancel；返回 null → no-tts
//   stop()
//   close()          stop() + 释放 AudioContext
// 返回值统一 { played: bool, reason?: 'locked'|'error'|'tts-error'|'no-tts'|'no-src'|'empty', interrupted?: bool }
//
// 打断模型：_begin() 先 stop() 再领一个 token；任何 await 之后 token 变了就说明被打断（新一段或 stop()）。
import { AudioLipSync } from './lipsync.js';
import { textToVisemeTimeline, visemeAt } from './visemes.js';
import { browserTts, cancelBrowserTts } from './tts.js';

const isSelfSpeaking = (r) => !!r && typeof r === 'object' && !!r.done && typeof r.done.then === 'function';

export class Voice {
  /** @param {{ setMouth?: Function, tts?: Function, lang?: string, lipsync?: AudioLipSync }} opts */
  constructor({ setMouth, tts = browserTts, lang = 'zh-CN', lipsync } = {}) {
    this.setMouth = setMouth || (() => {});
    this.tts = tts;
    this.lang = lang;
    this.lipsync = lipsync || new AudioLipSync();
    this._token = 0;
    this._raf = null;
    this._onStop = null;   // 当前一段的“被打断”回调，stop() 时触发
    this._cancel = null;   // 自出声 provider 提供的 cancel，stop() 时调用
  }

  get unlocked() { return this.lipsync.unlocked; }
  unlock() { this.lipsync.unlock(); }

  async playAudio(src) {
    if (!this.unlocked) return { played: false, reason: 'locked' };
    if (src == null) return { played: false, reason: 'no-src' };   // 空音源不打断正在说的
    return this._playAudio(src, this._begin());
  }

  /** 播音频，不再 _begin()（调用方已经领了 token） */
  async _playAudio(src, token) {
    if (token !== this._token) return { played: false, interrupted: true };
    this._pump(() => this.lipsync.sample());
    try {
      await this.lipsync.play(src);
      return { played: true, interrupted: token !== this._token };
    } catch (e) {
      if (token !== this._token) return { played: false, interrupted: true };
      if (e && e.code === 'closed') return { played: false, interrupted: true };   // 销毁后在飞的加载：算被打断
      if (e && e.code === 'locked') return { played: false, reason: 'locked' };
      console.warn('[voice] play failed', e);
      return { played: false, reason: 'error' };
    } finally {
      if (token === this._token) { this._stopPump(); this.setMouth(null); }
    }
  }

  async speakText(text) {
    if (!text) return { played: false, reason: 'empty' };
    if (!this.unlocked) return { played: false, reason: 'locked' };
    // 先领 token（会取消上一段），再调 provider —— 否则 provider 刚排上的语音会被我们自己 cancel 掉
    const token = this._begin();
    let res = null;
    try {
      res = await this.tts(text, { lang: this.lang });
    } catch (e) {
      if (token !== this._token) return { played: false, interrupted: true };
      console.warn('[voice] tts failed', e);
      return { played: false, reason: 'tts-error' };
    }
    // 先吞掉 done 的 rejection，避免被打断提前返回后变成未处理的 rejection
    if (isSelfSpeaking(res)) res.done.catch(() => {});
    if (token !== this._token) return { played: false, interrupted: true };   // 慢请求期间被 stop/打断
    if (!res) return { played: false, reason: 'no-tts' };
    if (!isSelfSpeaking(res)) return this._playAudio(res, token);
    this._cancel = typeof res.cancel === 'function' ? res.cancel : null;
    return this._speakAlong(text, res.done, token);
  }

  /** provider 自己出声：循环按字估算口型；结束由 done（或打断）驱动，rAF 只负责动画 */
  async _speakAlong(text, done, token) {
    const tl = textToVisemeTimeline(text);
    let t0 = performance.now();
    this._pump(() => {
      const now = performance.now();
      if (tl.duration > 0 && (now - t0) / 1000 >= tl.duration) t0 = now;   // 时间线跑完就从头再来
      return { viseme: visemeAt(tl, (now - t0) / 1000) };
    });
    const stopped = new Promise((resolve) => { this._onStop = resolve; });
    let failed = false;
    await Promise.race([done.then(() => {}, () => { failed = true; }), stopped]);
    if (token !== this._token) return { played: false, interrupted: true };
    this._onStop = null;
    this._cancel = null;
    this._stopPump();
    this.setMouth(null);
    return failed ? { played: false, reason: 'tts-error' } : { played: true, interrupted: false };
  }

  stop() {
    this._token++;
    this._stopPump();
    this.lipsync.stop();
    cancelBrowserTts();
    const cancel = this._cancel;
    this._cancel = null;
    if (cancel) { try { cancel(); } catch { /* provider 自己的取消失败不影响收尾 */ } }
    this.setMouth(null);
    const onStop = this._onStop;
    this._onStop = null;
    if (onStop) onStop();
  }

  /** 停止并释放底层音频资源（AudioContext）。宠物销毁时调用 */
  close() {
    this.stop();
    if (this.lipsync && typeof this.lipsync.close === 'function') this.lipsync.close();
  }

  _begin() { this.stop(); return this._token; }

  /** 每帧调 frameFn：返回口型帧（或 null=闭嘴）推给渲染器 */
  _pump(frameFn) {
    this._stopPump();
    const step = () => {
      const f = frameFn();
      this.setMouth(f);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPump() {
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
