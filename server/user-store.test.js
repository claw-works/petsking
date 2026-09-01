import { test, expect } from 'bun:test';
import { openDb } from './db.js';
import { createUserStore } from './user-store.js';

test('create + findByEmail roundtrip', () => {
  const users = createUserStore(openDb(':memory:'));
  const created = users.create('a@example.com', 'hashed');
  const found = users.findByEmail('a@example.com');
  expect(found.id).toBe(created.id);
  expect(found.email).toBe('a@example.com');
});

test('findByEmail returns undefined for unknown email', () => {
  const users = createUserStore(openDb(':memory:'));
  expect(users.findByEmail('nobody@example.com')).toBeUndefined();
});
