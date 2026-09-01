import { test, expect } from 'bun:test';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';

test('hashPassword + verifyPassword roundtrip', async () => {
  const hash = await hashPassword('s3cret');
  expect(await verifyPassword('s3cret', hash)).toBe(true);
  expect(await verifyPassword('wrong', hash)).toBe(false);
});

test('signToken + verifyToken roundtrip', async () => {
  const token = await signToken('user-123', 'test-secret');
  expect(await verifyToken(token, 'test-secret')).toBe('user-123');
});

test('verifyToken rejects a token signed with a different secret', async () => {
  const token = await signToken('user-123', 'test-secret');
  await expect(verifyToken(token, 'wrong-secret')).rejects.toThrow();
});
