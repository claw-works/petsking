// pet-lib/voice/voice.js — 语音调度：同一时刻只说一段，新的打断旧的；逐帧把口型推给渲染器
//
//   playAudio(src)   播音频（URL/Blob/ArrayBuffer），音频驱动口型
//   speakText(text)  调 TTS provider：拿到音频走 playAudio；provider 自己出声则按字估算口型
//   stop()
// 返回值统一 { played: bool, reason?: 'locked'|'error'|'tts-error'|'empty', interrupted?: bool }
import { AudioLipSync } from './lipsync.js';
import { textToVisemeTimeline, visemeAt } from './visemes.js';
import { browserTts, cancelBrowserTts } from './tts.js';

export class Voice {
  /** @param {{ setMouth?: Function, tts?: Function, lang?: string, lipsync?: AudioLipSync }} opts */
  constructor({ setMouth, tts = browserTts, lang = 'zh-CN', lipsync } = {}) {
    this.setMouth = setMouth || (() => {});
    this.tts = tts;
    this.lang = lang;
    this.lipsync = lipsync || new AudioLipSync();
    this._token = 0;
    this._raf = null;
    this._pumpDone = null;
  }

  get unlocked() { return this.lipsync.unlocked; }
  unlock() { this.lipsync.unlock(); }

  async playAudio(src) {
    if (!this.unlocked) return { played: false, reason: 'locked' };
    const token = this._begin();
    this._pump(() => this.lipsync.sample());
    try {
      await this.lipsync.play(src);
      return { played: true, interrupted: token !== this._token };
    } catch (e) {
      console.warn('[voice] play failed', e);
      return { played: false, reason: 'error' };
    } finally {
      if (token === this._token) { this._stopPump(); this.setMouth(null); }
    }
  }

  async speakText(text) {
    if (!text) return { played: false, reason: 'empty' };
    if (!this.unlocked) return { played: false, reason: 'locked' };
    let audio = null;
    try {
      audio = await this.tts(text, { lang: this.lang });
    } catch (e) {
      console.warn('[voice] tts failed', e);
      return { played: false, reason: 'tts-error' };
    }
    if (audio) return this.playAudio(audio);
    // provider 自己出声：按字估算口型，时间线跑完即结束
    const token = this._begin();
    const tl = textToVisemeTimeline(text);
    const t0 = performance.now();
    await new Promise((resolve) => {
      this._pump(() => {
        const t = (performance.now() - t0) / 1000;
        return t >= tl.duration ? false : { viseme: visemeAt(tl, t) };
      }, resolve);
    });
    if (token === this._token) this.setMouth(null);
    return { played: true, interrupted: token !== this._token };
  }

  stop() {
    this._token++;
    this._stopPump();
    this.lipsync.stop();
    cancelBrowserTts();
    this.setMouth(null);
  }

  _begin() { this.stop(); return this._token; }

  /** 每帧调 frameFn：返回口型帧（或 null=闭嘴）推给渲染器；返回 false 结束 */
  _pump(frameFn, onDone) {
    this._stopPump();
    this._pumpDone = onDone || null;
    const step = () => {
      const f = frameFn();
      if (f === false) { this._stopPump(); return; }
      this.setMouth(f);
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _stopPump() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    const done = this._pumpDone;
    this._pumpDone = null;
    if (done) done();
  }
}
