import { test, expect } from 'bun:test';
import { formatElapsed, buildSystemPrompt } from './prompt.js';

test('formatElapsed returns null for gaps under 2 minutes', () => {
  expect(formatElapsed(60 * 1000)).toBeNull();
});

test('formatElapsed formats days/hours/minutes', () => {
  expect(formatElapsed(3 * 24 * 60 * 60 * 1000)).toBe('距离上次聊天已经过去 3 天');
  expect(formatElapsed(5 * 60 * 60 * 1000)).toBe('距离上次聊天已经过去 5 小时');
  expect(formatElapsed(10 * 60 * 1000)).toBe('距离上次聊天已经过去 10 分钟');
});

test('buildSystemPrompt includes soul text and intent list, skips gap note without prior message', () => {
  const prompt = buildSystemPrompt({ soul: '你是一只猫', intents: ['happy', 'sad'], lastMessageAt: null });
  expect(prompt).toContain('你是一只猫');
  expect(prompt).toContain('happy / sad');
  expect(prompt).not.toContain('距离上次聊天');
});

test('buildSystemPrompt adds an elapsed-time note when there is a prior message', () => {
  const now = Date.now();
  const prompt = buildSystemPrompt({ soul: '人设', intents: ['happy'], lastMessageAt: now - 2 * 60 * 60 * 1000, now });
  expect(prompt).toContain('距离上次聊天已经过去 2 小时');
});
