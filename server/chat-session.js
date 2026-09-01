// server/chat-session.js — 单轮聊天编排：存库 → 拼 prompt → 调 provider → 转发事件 + 落库
import { buildSystemPrompt } from './prompt.js';

export async function* runChatTurn({ userId, petId, text, store, provider, soul, intents }) {
  // 先读上一条消息的时间，再插入这条用户消息——顺序不能反，
  // 否则"距离上次聊天过去多久"会算成 0。
  const lastMessageAt = store.lastMessageAt(userId, petId);
  store.appendMessage(userId, petId, { role: 'user', content: text });

  const history = store.listMessages(userId, petId, 50);
  const system = buildSystemPrompt({ soul, intents, lastMessageAt, now: Date.now() });
  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  let fullText = '';
  let lastAction = null;
  let persisted = false;

  try {
    for await (const event of provider.streamChat({ system, messages, intents })) {
      if (event.type === 'text_delta') {
        fullText += event.delta;
        yield { type: 'text_delta', delta: event.delta };
      } else if (event.type === 'tool_call' && event.name === 'perform_action') {
        const intent = event.input?.intent;
        if (intents.includes(intent)) {
          lastAction = intent;
          yield { type: 'action', intent };
        }
      } else if (event.type === 'done') {
        store.appendMessage(userId, petId, { role: 'assistant', content: fullText, action: lastAction });
        persisted = true;
        yield { type: 'done' };
      }
    }
  } catch (err) {
    // 流中断（例如 Bedrock 报错）时，已经吐给用户看到的部分回复也要落库，
    // 否则下一轮历史里会"凭空"缺一段用户已经读到的文本。
    if (!persisted && fullText) {
      store.appendMessage(userId, petId, { role: 'assistant', content: fullText, action: lastAction });
    }
    throw err;
  }
}
