import { test, expect } from 'bun:test';
import { runChatTurn } from './chat-session.js';

function createFakeStore(seed = []) {
  const messages = [...seed];
  return {
    appendMessage(userId, petId, msg) {
      messages.push({ userId, petId, ...msg, created_at: Date.now() });
    },
    listMessages(userId, petId) {
      return messages
        .filter((m) => m.userId === userId && m.petId === petId)
        .map(({ role, content, action }) => ({ role, content, action }));
    },
    lastMessageAt(userId, petId) {
      const own = messages.filter((m) => m.userId === userId && m.petId === petId);
      return own.length ? own[own.length - 1].created_at : null;
    },
    _all: messages,
  };
}

function createFakeProvider(events) {
  return {
    calls: [],
    async *streamChat(input) {
      this.calls.push(input);
      for (const e of events) yield e;
    },
  };
}

test('runChatTurn streams text deltas and persists the full assistant reply', async () => {
  const store = createFakeStore();
  const provider = createFakeProvider([
    { type: 'text_delta', delta: '你好' },
    { type: 'text_delta', delta: '呀' },
    { type: 'done' },
  ]);

  const out = [];
  for await (const ev of runChatTurn({
    userId: 'u1',
    petId: 'blue-whale',
    text: '嗨',
    store,
    provider,
    soul: '你是一只友好的宠物。',
    intents: ['greet', 'happy'],
  })) out.push(ev);

  expect(out).toEqual([
    { type: 'text_delta', delta: '你好' },
    { type: 'text_delta', delta: '呀' },
    { type: 'done' },
  ]);
  expect(store._all).toHaveLength(2);
  expect(store._all[0]).toMatchObject({ role: 'user', content: '嗨' });
  expect(store._all[1]).toMatchObject({ role: 'assistant', content: '你好呀', action: null });
});

test('runChatTurn emits an action event for a valid perform_action call and filters invalid intents', async () => {
  const store = createFakeStore();
  const provider = createFakeProvider([
    { type: 'tool_call', name: 'perform_action', input: { intent: 'happy' } },
    { type: 'tool_call', name: 'perform_action', input: { intent: 'not-a-real-intent' } },
    { type: 'text_delta', delta: '嗯嗯' },
    { type: 'done' },
  ]);

  const out = [];
  for await (const ev of runChatTurn({
    userId: 'u1',
    petId: 'blue-whale',
    text: '你好呀',
    store,
    provider,
    soul: '人设',
    intents: ['greet', 'happy'],
  })) out.push(ev);

  expect(out).toEqual([
    { type: 'action', intent: 'happy' },
    { type: 'text_delta', delta: '嗯嗯' },
    { type: 'done' },
  ]);
  expect(store._all[1]).toMatchObject({ action: 'happy' });
});

test('runChatTurn tells the model how long it has been since the previous message', async () => {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const store = createFakeStore([
    { userId: 'u1', petId: 'blue-whale', role: 'assistant', content: '之前聊过', action: null, created_at: threeDaysAgo },
  ]);
  const provider = createFakeProvider([{ type: 'text_delta', delta: '好久不见' }, { type: 'done' }]);

  const out = [];
  for await (const ev of runChatTurn({
    userId: 'u1',
    petId: 'blue-whale',
    text: '在吗',
    store,
    provider,
    soul: '人设',
    intents: ['greet'],
  })) out.push(ev);

  expect(provider.calls[0].system).toContain('距离上次聊天已经过去 3 天');
});
