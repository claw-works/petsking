// server/llm/bedrock-provider.js — 用 Bedrock Converse Stream API 实现 LlmProvider 契约
import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildPerformActionTool } from './intent-tool.js';

export class BedrockProvider {
  constructor({ region, modelId }) {
    this.client = new BedrockRuntimeClient({ region });
    this.modelId = modelId;
  }

  async *streamChat({ system, messages, intents }) {
    const command = new ConverseStreamCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
      toolConfig: { tools: [buildPerformActionTool(intents)] },
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
