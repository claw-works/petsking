// server/llm/provider.js — LlmProvider 契约（文档用，不含实现）
//
// 任何 LLM provider 需要实现：
//
// streamChat({ system: string, messages: {role:'user'|'assistant', content:string}[], intents: string[] })
//   => AsyncIterable<
//        { type: 'text_delta', delta: string }
//        | { type: 'tool_call', name: string, input: any }
//        | { type: 'done' }
//      >
//
// 换 provider（比如换模型厂商）只需要新写一个实现这个契约的 class，
// chat-session.js 不需要改。

/** @typedef {{ role: 'user'|'assistant', content: string }} ChatMessage */
/** @typedef {{ type: 'text_delta', delta: string } | { type: 'tool_call', name: string, input: any } | { type: 'done' }} ChatStreamEvent */
