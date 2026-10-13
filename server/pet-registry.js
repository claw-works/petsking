// server/pet-registry.js — 从 pets/index.json 构建"可聊天宠物"注册表（收录 chat: true 的宠物）
export const FALLBACK_SOUL = `你是桌面陪伴宠物，用户还没有为你写专属人设。用简短、友好、略带活泼的语气正常聊天即可，不用扮演任何特定角色设定。
你可以在合适的时候调用 perform_action 触发一个动作反应，但不要每句话都调用。
台词尽量简短（一两句话）。`;

export function buildPetRegistry(petsIndex, { readManifest, readSoul }) {
  const registry = new Map();
  for (const entry of petsIndex.pets) {
    if (entry.chat !== true) continue;
    const manifest = readManifest(entry);
    const intents = Object.keys(manifest.intentMap || {});
    const soul = readSoul(entry) ?? FALLBACK_SOUL;
    registry.set(entry.id, { soul, intents });
  }
  return registry;
}
