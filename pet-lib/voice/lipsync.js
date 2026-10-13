// pet-lib/voice/lipsync.js — WebAudio 播放 + 逐帧口型分析（移植自清霄 AudioLipSync）
//
// 只分析音频信号，不需要音素时间线，所以任意来源的语音都能驱动口型：
// 预录 mp3、云 TTS 返回的音频、克隆音色……
import { mouthFeatures } from './mouth-features.js';

export class AudioLipSync {
  constructor() {
    this.ctx = null;
    this.cache = new Map();   // url → Promise<AudioBuffer>
    this.current = null;
    this._state = { peak: 0.05 };
  }

  /** 浏览器自动播放策略：页面上有过用户手势之后才能出声 */
  get unlocked() {
    const ua = typeof navigator !== 'undefined' && navigator.userActivation;
    return ua ? ua.hasBeenActive : true;
  }

  unlock() { this._ensure(); }

  _ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.35;
      this.analyser.connect(this.ctx.destination);
      this._time = new Float32Array(this.analyser.fftSize);
      this._freq = new Float32Array(this.analyser.frequencyBinCount);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** src: URL 字符串（带缓存）/ Blob / ArrayBuffer */
  async load(src) {
    if (typeof src !== 'string') {
      const buf = src instanceof Blob ? await src.arrayBuffer() : src.slice(0); // decodeAudioData 会 detach，复制一份
      return this._ensure().decodeAudioData(buf);
    }
    if (this.cache.has(src)) return this.cache.get(src);
    const p = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => this._ensure().decodeAudioData(buf));
    this.cache.set(src, p);
    try {
      return await p;
    } catch (e) {
      this.cache.delete(src);
      throw e;
    }
  }

  /** 播放；播完（或被 stop）时 resolve */
  async play(src) {
    const buffer = await this.load(src);
    const ctx = this._ensure();
    this.stop();
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.analyser);
    const done = new Promise((res) => { node.onended = res; });
    this.current = node;
    this._state = { peak: 0.05 };
    node.start();
    await done;
    if (this.current === node) this.current = null;
  }

  stop() {
    if (this.current) {
      try { this.current.stop(); } catch { /* 已停 */ }
      this.current = null;
    }
  }

  get playing() { return !!this.current; }

  /** 当前口型特征 { open, wide, round }（0..1）；没在播返回 null */
  sample() {
    if (!this.current) return null;
    this.analyser.getFloatTimeDomainData(this._time);
    this.analyser.getFloatFrequencyData(this._freq);
    return mouthFeatures(this._time, this._freq, this.ctx.sampleRate, this.analyser.fftSize, this._state);
  }
}
