// llm-adapter.js — 可选 LLM 适配器
//
// 让「模型」参与驱动：给一段上下文，模型返回 { intent, say }，
// 桌宠据此做一次性表演 + 冒泡说话。适配器不绑定任何具体厂商——
// 接入方注入一个 complete(prompt) => Promise<string> 的函数即可（走你已有的 key/网关）。
//
// 典型用法：
//   const llm = new LlmAdapter(pet, { complete: myCompleteFn, intents: bridge.intentMap });
//   await llm.react('用户夸了它很可爱');   // 模型决定 intent+台词，宠物表演+说话

const SYSTEM = `你是桌面宠物的“行为决策器”。根据给定情境，只输出一行 JSON：
{"intent":"<意图>","say":"<不超过20字的中文台词>"}
intent 从这些里选一个：{INTENTS}。不要输出别的内容。`;

export class LlmAdapter {
  /**
   * @param {DeskPet} pet
   * @param {Object} opts
   *   complete(prompt) => Promise<string>   接入方提供的模型调用（必填）
   *   intents: string[]                     可选意图集合（默认取 bridge.intentMap 的键）
   *   onSay(text)                           说话回调（默认调 pet.say）
   */
  constructor(pet, opts = {}) {
    this.pet = pet;
    this.complete = opts.complete;
    this.intents = opts.intents || ['greet', 'happy', 'shy', 'sad', 'angry', 'think', 'dance', 'sleep', 'wave', 'jump'];
    this.onSay = opts.onSay || ((t) => pet.say && pet.say(t));
  }

  _prompt(context) {
    const sys = SYSTEM.replace('{INTENTS}', this.intents.join(' / '));
    return `${sys}\n\n情境：${context}\n输出：`;
  }

  /** 解析模型输出，容错取 intent/say */
  _parse(text) {
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { const o = JSON.parse(m[0]); return { intent: o.intent, say: o.say }; }
    } catch (e) { /* ignore */ }
    // 兜底：从文本里找一个已知 intent
    const hit = this.intents.find((i) => text.includes(i));
    return { intent: hit || 'think', say: '' };
  }

  /** 给一段情境，让模型决定反应；返回 { intent, say } 并已驱动宠物 */
  async react(context) {
    if (!this.complete) throw new Error('LlmAdapter 需要注入 complete(prompt) 函数');
    const raw = await this.complete(this._prompt(context));
    const { intent, say } = this._parse(raw);
    // 有 say 时跳过意图自带的预录台词：否则台词气泡会和模型的 say 气泡互相覆盖
    if (this.pet.bridge) this.pet.bridge.reactTo(intent, { silent: !!say });
    else this.pet.play(intent, { loop: false });
    if (say) this.onSay(say);
    return { intent, say };
  }
}
