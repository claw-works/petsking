// pet-lib/voice/tts.js — TTS provider 接口 + 默认实现
//
// provider 签名：(text, { lang }) => Promise<Blob | ArrayBuffer | string(url) | null>
//   返回音频 → Voice 用 lipsync 播放并按音频驱动口型（推荐：云 TTS、克隆音色）
//   返回 null → provider 已经自己出声（如浏览器 TTS），Voice 按字估算口型
// 宿主项目通过 createPet({ voice: { tts: myProvider } }) 注入，库不绑任何厂商。

export async function browserTts(text, { lang = 'zh-CN', rate = 1.05 } = {}) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return null;
}

export function cancelBrowserTts() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
}
