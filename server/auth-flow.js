// server/auth-flow.js — 注册/登录编排（组合 user-store + auth）
import { hashPassword, verifyPassword, signToken } from './auth.js';

export class AuthError extends Error {}

export async function registerUser({ email, password }, userStore, secret) {
  if (!email || !password) throw new AuthError('email and password required');
  if (userStore.findByEmail(email)) throw new AuthError('email already registered');
  const passwordHash = await hashPassword(password);
  const user = userStore.create(email, passwordHash);
  const token = await signToken(user.id, secret);
  return { token };
}

export async function loginUser({ email, password }, userStore, secret) {
  const user = userStore.findByEmail(email);
  if (!user) throw new AuthError('invalid credentials');
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AuthError('invalid credentials');
  const token = await signToken(user.id, secret);
  return { token };
}
