import { test, expect } from 'bun:test';
import { openDb } from '../db.js';
import { SqliteConversationStore } from './sqlite-conversation-store.js';

test('appendMessage + listMessages roundtrip ordered by time', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));
  store.appendMessage('u1', 'blue-whale', { role: 'user', content: '你好' });
  store.appendMessage('u1', 'blue-whale', { role: 'assistant', content: '嗨呀', action: 'greet' });

  const msgs = store.listMessages('u1', 'blue-whale');
  expect(msgs).toHaveLength(2);
  expect(msgs[0]).toMatchObject({ role: 'user', content: '你好' });
  expect(msgs[1]).toMatchObject({ role: 'assistant', content: '嗨呀', action: 'greet' });
});

test('messages are isolated per user', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));
  store.appendMessage('u1', 'blue-whale', { role: 'user', content: '我是u1' });
  store.appendMessage('u2', 'blue-whale', { role: 'user', content: '我是u2' });

  expect(store.listMessages('u1', 'blue-whale')).toHaveLength(1);
  expect(store.listMessages('u2', 'blue-whale')).toHaveLength(1);
});

test('lastMessageAt returns null with no history, else the latest timestamp', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));
  expect(store.lastMessageAt('u1', 'blue-whale')).toBeNull();
  store.appendMessage('u1', 'blue-whale', { role: 'user', content: '嗨' });
  expect(typeof store.lastMessageAt('u1', 'blue-whale')).toBe('number');
});

test('listMessages returns the most recent N messages in chronological order when there is more history than the limit', () => {
  const store = new SqliteConversationStore(openDb(':memory:'));

  // Force strictly increasing timestamps so the test is deterministic even
  // though appendMessage() relies on Date.now(), which can produce duplicate
  // millisecond values in a tight synchronous loop.
  const realDateNow = Date.now;
  let fakeNow = realDateNow();
  Date.now = () => (fakeNow += 1);
  try {
    for (let i = 0; i < 55; i++) {
      store.appendMessage('u1', 'blue-whale', { role: 'user', content: `msg-${i}` });
    }
  } finally {
    Date.now = realDateNow;
  }

  const msgs = store.listMessages('u1', 'blue-whale', 50);
  expect(msgs).toHaveLength(50);

  // Should be the most recent 50 (msg-5 .. msg-54), not the oldest 50.
  const contents = msgs.map((m) => m.content);
  const expected = Array.from({ length: 50 }, (_, i) => `msg-${i + 5}`);
  expect(contents).toEqual(expected);

  // Still in ascending chronological order.
  for (let i = 1; i < msgs.length; i++) {
    expect(msgs[i].created_at).toBeGreaterThanOrEqual(msgs[i - 1].created_at);
  }
});
