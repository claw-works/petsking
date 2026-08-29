// index.js — pet-lib 公开 API 出口
//
// 最简用法：
//   import { createPet } from './pet-lib/index.js';
//   const pet = await createPet({ pet: 'blue-whale', renderer: 'webm', driver: 'chain' });
//
// 接 Agent：
//   const pet = await createPet({ pet:'blue-whale', driver:'statemachine', ai:{ enabled:true } });
//   pet.feed({ type:'agent.thinking' });      // 或 pet.bridge.dispatch(原始事件)
//   pet.react('happy');                        // 意图表演

import './renderers/index.js';  // 注册所有渲染器
import './core/index.js';       // 注册所有驱动
import { DeskPet } from './pet.js';
import { mergeConfig, loadAssetPack } from './config.js';

/**
 * 创建并初始化一只桌宠。
 * @param {Object} config 见 config.js 顶部注释
 * @returns {Promise<DeskPet>}
 */
export async function createPet(config = {}) {
  const cfg = mergeConfig(config);
  const pack = await loadAssetPack(config.pet, config.petsBaseUrl || 'pets/');
  const pet = new DeskPet(cfg, pack);
  await pet.init();

  // 若启用 AI 且提供了 LLM，挂上 adapter
  if (cfg.ai && cfg.ai.enabled && cfg.ai.llm && cfg.ai.llm.complete) {
    const { LlmAdapter } = await import('./ai/llm-adapter.js');
    pet.llm = new LlmAdapter(pet, { complete: cfg.ai.llm.complete, onSay: (t) => pet.say(t) });
  }
  return pet;
}

export { DeskPet } from './pet.js';
export { mergeConfig, loadAssetPack, DEFAULT_CONFIG, SCENES } from './config.js';
export { RENDERERS, createRenderer, registerRenderer, RendererBase } from './renderers/renderer-base.js';
export { DRIVERS, createDriver, registerDriver, DriverBase } from './core/driver-base.js';
export { AgentBridge, LlmAdapter, STD_EVENTS, DEFAULT_INTENT_MAP } from './ai/index.js';
