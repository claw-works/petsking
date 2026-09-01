// server/auth.js — 密码哈希 + JWT 签发/校验（纯函数，不接触数据库）
import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

export async function hashPassword(password) {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

export async function verifyPassword(password, hash) {
  return Bun.password.verify(password, hash);
}

export async function signToken(userId, secret) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(encoder.encode(secret));
}

export async function verifyToken(token, secret) {
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  return payload.sub;
}
