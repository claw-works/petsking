// pet-lib/voice/voice-pack.js — 预录语音包
//
// 格式（与清霄语音包一致）：index.json = { lines: [{ id, text, label?, expression?, file, duration? }] }
// file 相对 index.json 所在目录；以 / 或协议开头则原样使用。

const ABS_RE = /^(https?:|blob:|data:|\/)/;

export function createVoicePack(data, baseUrl) {
  const lines = (data && data.lines) || [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  return {
    lines,
    get: (id) => byId.get(id) || null,
    url: (line) => (ABS_RE.test(line.file) ? line.file : baseUrl + encodeURI(line.file)),
  };
}

export async function loadVoicePack(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error('voice pack ' + url + ': HTTP ' + res.status);
  const data = await res.json();
  return createVoicePack(data, url.slice(0, url.lastIndexOf('/') + 1));
}
