// pet-lib/voice/lipsync.js — WebAudio 播放 + 逐帧口型分析（移植自清霄 AudioLipSync）
//
// 只分析音频信号，不需要音素时间线，所以任意来源的语音都能驱动口型：
// 预录 mp3、云 TTS 返回的音频、克隆音色……
//
// 打断模型：stop() 让代数 _gen +1 并立即 resolve 正在播的那段；play() 入口先 stop()（取代之前所有
// 还在加载的 play），加载/resume 之后代数变了就直接 resolve，绝不去停掉更新的那段。
import { mouthFeatures } from './mouth-features.js';

const RESUME_WAIT_MS = 1000;   // ctx.resume() 在没有用户手势时可能一直 pending，最多等这么久
const SAFETY_PAD_MS = 500;     // onended 不触发时的兜底：时长 + 这么多毫秒后强制结束

const noCache = (url) => /^(blob|data):/i.test(url);   // 一次性 URL（TTS 每次新生成）不缓存，免得无限增长
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AudioLipSync {
  constructor() {
    this.ctx = null;
    this.cache = new Map();   // url → Promise<AudioBuffer>
    this.current = null;
    this._finish = null;      // 结束当前这段（resolve 它的 done）
    this._gen = 0;
    this._state = { peak: 0.05 };
  }

  /**
   * 浏览器自动播放策略：页面上有过用户手势之后才能出声。
   * 没有 userActivation API 时乐观返回 true，真正能不能出声由 play() 里的 resume 检查兜底（失败抛 code='locked'）。
   */
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
    if (this.ctx.state === 'suspended') Promise.resolve(this.ctx.resume()).catch(() => {});
    return this.ctx;
  }

  /** src: URL 字符串（带缓存，blob:/data: 除外）/ Blob / ArrayBuffer / TypedArray */
  async load(src) {
    if (typeof src !== 'string') {
      // decodeAudioData 会 detach 传入的 buffer，所以一律复制一份
      let buf;
      if (typeof Blob !== 'undefined' && src instanceof Blob) buf = await src.arrayBuffer();
      else if (ArrayBuffer.isView(src)) buf = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
      else buf = src.slice(0);
      return this._ensure().decodeAudioData(buf);
    }
    if (this.cache.has(src)) return this.cache.get(src);
    const p = fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => this._ensure().decodeAudioData(buf));
    if (noCache(src)) return p;
    this.cache.set(src, p);
    try {
      return await p;
    } catch (e) {
      this.cache.delete(src);
      throw e;
    }
  }

  /** 播放；播完、被 stop 或被更新的 play 取代时 resolve。AudioContext 起不来时抛 Error(code='locked') */
  async play(src) {
    this.stop();               // 取代之前正在播 / 还在加载的那段
    const gen = this._gen;
    const buffer = await this.load(src);
    if (gen !== this._gen) return;
    const ctx = this._ensure();
    if (ctx.state !== 'running') {
      try {
        await Promise.race([Promise.resolve(ctx.resume()), sleep(RESUME_WAIT_MS)]);
      } catch { /* 下面按状态判断 */ }
      if (gen !== this._gen) return;
      if (ctx.state !== 'running') {
        const err = new Error(`AudioContext not running (${ctx.state})`);
        err.code = 'locked';
        throw err;
      }
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.analyser);
    let timer = null;
    const done = new Promise((res) => {
      const finish = () => { clearTimeout(timer); res(); };
      node.onended = finish;
      this._finish = finish;
      timer = setTimeout(() => {
        try { node.stop(); } catch { /* 已停 */ }   // 兜底结束时也停节点，免得之后被 resume 的 ctx 偷偷播出来
        finish();
      }, (buffer.duration || 0) * 1000 + SAFETY_PAD_MS);
    });
    this.current = node;
    this._state = { peak: 0.05 };
    node.start();
    await done;
    if (this.current === node) { this.current = null; this._finish = null; }
  }

  stop() {
    this._gen++;
    if (this.current) {
      try { this.current.stop(); } catch { /* 已停 */ }
      this.current = null;
    }
    const finish = this._finish;
    this._finish = null;
    if (finish) finish();
  }

  /** 彻底释放：停播 + 关闭 AudioContext（之后再 play 会重新建一个）。宠物销毁时调用 */
  close() {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.analyser = null;
    this.cache.clear();   // 已解码的 AudioBuffer 属于旧 ctx 的生命周期，一并丢掉
    if (ctx && typeof ctx.close === 'function') Promise.resolve(ctx.close()).catch(() => {});
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
