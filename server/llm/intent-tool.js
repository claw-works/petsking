// server/llm/intent-tool.js — 把宠物的 intent 列表包成 Bedrock 的 perform_action 工具 schema
export function buildPerformActionTool(intents) {
  return {
    toolSpec: {
      name: 'perform_action',
      description: '触发一个宠物动作/表情反应',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            intent: { type: 'string', enum: intents },
          },
          required: ['intent'],
        },
      },
    },
  };
}
