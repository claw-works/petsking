// System prompt 拼装：人设 + 可用意图 + 时间差提示

export function formatElapsed(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 2) return null;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `距离上次聊天已经过去 ${days} 天`;
  if (hours >= 1) return `距离上次聊天已经过去 ${hours} 小时`;
  return `距离上次聊天已经过去 ${minutes} 分钟`;
}

export function buildSystemPrompt({ soul, intents, lastMessageAt, now = Date.now() }) {
  const parts = [soul.trim()];
  parts.push(
    `你可以在合适的时候调用 perform_action 工具触发一个动作反应，intent 从这些里选：${intents.join(' / ')}。不要每句话都调用，只在情绪明显变化时用。无论是否调用这个工具，每次回复都必须说一点话，不能只调用工具而不说任何文字。`
  );
  if (lastMessageAt != null) {
    const gap = formatElapsed(now - lastMessageAt);
    if (gap) parts.push(gap + '，用户刚刚回来找你说话。');
  }
  return parts.join('\n\n');
}
