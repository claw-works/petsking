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
