import { test, expect } from 'bun:test';
import { buildPerformActionTool } from './intent-tool.js';

test('buildPerformActionTool builds a Bedrock toolSpec with an intent enum', () => {
  const tool = buildPerformActionTool(['greet', 'happy', 'sad']);
  expect(tool.toolSpec.name).toBe('perform_action');
  expect(tool.toolSpec.inputSchema.json.properties.intent.enum).toEqual(['greet', 'happy', 'sad']);
  expect(tool.toolSpec.inputSchema.json.required).toEqual(['intent']);
});
