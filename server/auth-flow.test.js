import { test, expect } from 'bun:test';
import { openDb } from './db.js';
import { createUserStore } from './user-store.js';
import { registerUser, loginUser, AuthError } from './auth-flow.js';

test('registerUser creates a user and returns a token', async () => {
  const users = createUserStore(openDb(':memory:'));
  const { token } = await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  expect(typeof token).toBe('string');
  expect(users.findByEmail('a@example.com')).toBeTruthy();
});

test('registerUser rejects a duplicate email', async () => {
  const users = createUserStore(openDb(':memory:'));
  await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  await expect(
    registerUser({ email: 'a@example.com', password: 'other' }, users, 'secret')
  ).rejects.toBeInstanceOf(AuthError);
});

test('registerUser rejects missing email or password', async () => {
  const users = createUserStore(openDb(':memory:'));
  await expect(registerUser({ email: '', password: '' }, users, 'secret')).rejects.toBeInstanceOf(AuthError);
});

test('loginUser returns a token for correct credentials', async () => {
  const users = createUserStore(openDb(':memory:'));
  await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  const { token } = await loginUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  expect(typeof token).toBe('string');
});

test('loginUser rejects wrong password or unknown email', async () => {
  const users = createUserStore(openDb(':memory:'));
  await registerUser({ email: 'a@example.com', password: 's3cret' }, users, 'secret');
  await expect(loginUser({ email: 'a@example.com', password: 'wrong' }, users, 'secret')).rejects.toBeInstanceOf(AuthError);
  await expect(loginUser({ email: 'nobody@example.com', password: 'x' }, users, 'secret')).rejects.toBeInstanceOf(AuthError);
});
