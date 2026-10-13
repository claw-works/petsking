// pet-lib/voice/tts.js — TTS provider 接口 + 默认实现
//
// provider 签名：(text, { lang }) => Promise<结果>，结果三选一：
//   (a) 音频：Blob | ArrayBuffer | TypedArray | string(url)
//       → Voice 用 lipsync 播放并按音频驱动口型（推荐：云 TTS、克隆音色）
//   (b) { done: Promise, cancel?: () => void }：provider 已经自己出声（如浏览器 TTS）
//       → Voice 循环播放按字估算的口型时间线，直到 done 落定（resolve/reject）才结束；
//         被 stop()/新一段打断时 Voice 会调用 cancel()（可选，抛错会被吞掉）
//   (c) null：没有可用的发声手段 → Voice 返回 { played: false, reason: 'no-tts' }，不动嘴
// 宿主项目通过 createPet({ voice: { tts: myProvider } }) 注入，库不绑任何厂商。

const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export async function browserTts(text, { lang = 'zh-CN', rate = 1.05 } = {}) {
  if (!hasSpeech() || typeof SpeechSynthesisUtterance === 'undefined') return null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  const done = new Promise((resolve) => {
    // 兜底：部分浏览器偶发不触发 onend，按字数给个上限，避免永远“在说话”
    const timer = setTimeout(resolve, 3000 + [...(text || '')].length * 400);
    const finish = () => { clearTimeout(timer); resolve(); };
    u.onend = finish;
    u.onerror = finish;   // 被 cancel 时也会走 onerror（interrupted/canceled）
  });
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return { done, cancel: () => speechSynthesis.cancel() };
}

export function cancelBrowserTts() {
  if (hasSpeech()) speechSynthesis.cancel();
}
