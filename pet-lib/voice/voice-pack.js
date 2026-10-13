// pet-lib/voice/voice-pack.js — 预录语音包
//
// 格式（与清霄语音包一致）：index.json = { lines: [{ id, text, label?, expression?, file, duration? }] }
// file 相对 index.json 所在目录；以 / 或任意协议（http: blob: data: file: app: …）开头则原样使用。

const ABS_RE = /^([a-z][a-z0-9+.-]*:|\/)/i;

/** 逐段编码（# ? 空格等都转义）；已编码过的段先解码再编码，避免 %XX 被二次编码 */
function encodeSegment(seg) {
  try {
    return encodeURIComponent(decodeURIComponent(seg));
  } catch {
    return encodeURIComponent(seg);   // 含非法 % 序列，按原文编码
  }
}

export function createVoicePack(data, baseUrl) {
  const lines = (data && data.lines) || [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    lines,
    get: (id) => byId.get(id) || null,
    url: (line) => {
      const file = line && line.file;
      if (!file) return null;
      if (ABS_RE.test(file)) return file;
      return baseUrl + file.split('/').map(encodeSegment).join('/');
    },
  };
}

export async function loadVoicePack(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('voice pack ' + url + ': HTTP ' + res.status);
  const data = await res.json();
  return createVoicePack(data, url.slice(0, url.lastIndexOf('/') + 1));
}
