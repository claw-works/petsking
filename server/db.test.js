import { test, expect } from 'bun:test';
import { openDb } from './db.js';

test('openDb creates the users table', () => {
  const db = openDb(':memory:');
  db.query(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`
  ).run('u1', 'a@example.com', 'hash', Date.now());
  const row = db.query(`SELECT * FROM users WHERE id = ?`).get('u1');
  expect(row.email).toBe('a@example.com');
});

test('openDb creates the messages table', () => {
  const db = openDb(':memory:');
  db.query(
    `INSERT INTO messages (id, user_id, pet_id, role, content, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('m1', 'u1', 'blue-whale', 'user', '你好', null, Date.now());
  const row = db.query(`SELECT * FROM messages WHERE id = ?`).get('m1');
  expect(row.content).toBe('你好');
});
