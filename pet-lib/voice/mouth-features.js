// pet-lib/voice/mouth-features.js — 一帧音频 → 口型特征（纯函数，对任意语音通用）
//
//   open  响度（自适应归一化：跟随近期峰值，响/轻的录音都能用）
//   wide  1.5–3.5kHz 能量占比（高 F2：i / e）
//   round 800Hz 以下能量占比且高频少（o / u）
// state = { peak } 由调用方跨帧持有。

export function mouthFeatures(time, freqDb, sampleRate, fftSize, state) {
  let sum = 0;
  for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
  const rms = Math.sqrt(sum / time.length);
  state.peak = Math.max(rms, state.peak * 0.995, 0.02);
  const gate = 0.12; // 低于峰值的这个比例就闭嘴
  let open = (rms / state.peak - gate) / (1 - gate);
  open = Math.min(1, Math.max(0, open)) ** 0.8;

  const hz = sampleRate / fftSize;
  const band = (lo, hi) => {
    let e = 0;
    for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz) && i < freqDb.length; i++) e += 10 ** (freqDb[i] / 10);
    return e;
  };
  const low = band(200, 800);
  const mid = band(800, 1500);
  const high = band(1500, 3500);
  const tot = low + mid + high + 1e-12;
  const wide = Math.min(1, Math.max(0, (high / tot - 0.12) / 0.3));
  const round = Math.min(1, Math.max(0, (low / tot - 0.65) / 0.25)) * (1 - wide);
  return { open, wide, round };
}
