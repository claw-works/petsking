import { test, expect } from 'bun:test';
import { buildPetRegistry, FALLBACK_SOUL } from './pet-registry.js';

test('buildPetRegistry only includes pets marked chat: true', () => {
  const petsIndex = {
    pets: [
      { id: 'a', renderers: ['webm'], path: 'a/pet.json', chat: true },
      { id: 'b', renderers: ['gif'], path: 'b/pet.json' },
      { id: 'c', renderers: ['gltf'], path: 'c/pet.json', chat: true },
      { id: 'd', renderers: ['webm'], path: 'd/pet.json' },
    ],
  };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { greet: 'wave' } }),
    readSoul: () => 'custom soul',
  });
  expect([...registry.keys()]).toEqual(['a', 'c']);
});

test('intentMap 的值是表演对象时，intents 仍取 key', () => {
  const petsIndex = { pets: [{ id: 'q', renderers: ['gltf'], path: 'q/pet.json', chat: true }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { greet: { action: 'idle', voice: 'hello' }, sad: 'idle' } }),
    readSoul: () => 'soul',
  });
  expect(registry.get('q').intents).toEqual(['greet', 'sad']);
});

test('buildPetRegistry falls back to the generic soul when readSoul returns null', () => {
  const petsIndex = { pets: [{ id: 'a', renderers: ['webm'], path: 'a/pet.json', chat: true }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { happy: 'cheer' } }),
    readSoul: () => null,
  });
  expect(registry.get('a').soul).toBe(FALLBACK_SOUL);
  expect(registry.get('a').intents).toEqual(['happy']);
});

test('buildPetRegistry uses the real soul when readSoul returns text', () => {
  const petsIndex = { pets: [{ id: 'a', renderers: ['webm'], path: 'a/pet.json', chat: true }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: {} }),
    readSoul: () => '专属人设文本',
  });
  expect(registry.get('a').soul).toBe('专属人设文本');
});
