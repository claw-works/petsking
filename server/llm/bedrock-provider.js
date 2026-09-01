// server/llm/bedrock-provider.js — 用 Bedrock Converse Stream API 实现 LlmProvider 契约
import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { buildPerformActionTool } from './intent-tool.js';

export class BedrockProvider {
  constructor({ region, modelId }) {
    // Bun's http2 client hangs indefinitely against the AWS SDK's default
    // NodeHttp2Handler for bedrock-runtime (confirmed during Task 15 manual
    // verification: both ConverseCommand and ConverseStreamCommand time out
    // with "http2 request did not get a response" under `bun run`). Forcing
    // the HTTP/1.1 handler avoids that and streams correctly.
    this.client = new BedrockRuntimeClient({ region, requestHandler: new NodeHttpHandler() });
    this.modelId = modelId;
  }

  async *streamChat({ system, messages, intents }) {
    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      // Bedrock's Converse API rejects empty/whitespace-only text content blocks.
      // A stored turn can legitimately have empty text when the model responded
      // with only a perform_action tool call and no words (confirmed live during
      // Task 15 manual verification — it broke the very next turn with
      // "text content blocks must be non-empty" otherwise). Fall back to a small
      // non-empty placeholder so history replay stays valid.
      messages: messages.map((m) => ({
        role: m.role,
        content: [{ text: m.content && m.content.trim() ? m.content : '...' }],
      })),
      toolConfig: { tools: [buildPerformActionTool(intents)] },
      // Without an explicit cap, Bedrock can default maxTokens to the model's
      // absolute maximum output length, reserving a large token budget per
      // request — a common cause of unexpected cost and ThrottlingExceptions.
      // This pet persona replies in one or two sentences (see soul.md), so
      // 1024 is a generous-but-bounded cap, not a functional restriction.
      inferenceConfig: { maxTokens: 1024 },
    });

    const response = await this.client.send(command);
    let toolName = null;
    let toolInputJson = '';

    for await (const event of response.stream) {
      const fault =
        event.internalServerException ||
        event.modelStreamErrorException ||
        event.throttlingException ||
        event.validationException ||
        event.serviceUnavailableException;
      if (fault) throw fault;
      if (event.contentBlockStart?.start?.toolUse) {
        toolName = event.contentBlockStart.start.toolUse.name;
        toolInputJson = '';
      }
      if (event.contentBlockDelta?.delta?.text) {
        yield { type: 'text_delta', delta: event.contentBlockDelta.delta.text };
      }
      if (event.contentBlockDelta?.delta?.toolUse?.input) {
        toolInputJson += event.contentBlockDelta.delta.toolUse.input;
      }
      if (event.contentBlockStop && toolName) {
        try {
          const input = JSON.parse(toolInputJson || '{}');
          yield { type: 'tool_call', name: toolName, input };
        } catch (err) {
          console.warn('perform_action 工具参数不是合法 JSON，忽略这次调用:', toolInputJson, err);
        }
        toolName = null;
      }
      if (event.messageStop) {
        yield { type: 'done' };
      }
    }
  }
}
