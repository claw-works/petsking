import { test, expect } from 'bun:test';
import { buildPetRegistry, FALLBACK_SOUL } from './pet-registry.js';

test('buildPetRegistry only includes webm-renderer pets', () => {
  const petsIndex = {
    pets: [
      { id: 'a', renderers: ['webm'], path: 'a/pet.json' },
      { id: 'b', renderers: ['gif'], path: 'b/pet.json' },
    ],
  };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { greet: 'wave' } }),
    readSoul: () => 'custom soul',
  });
  expect(registry.has('a')).toBe(true);
  expect(registry.has('b')).toBe(false);
});

test('buildPetRegistry falls back to the generic soul when readSoul returns null', () => {
  const petsIndex = { pets: [{ id: 'a', renderers: ['webm'], path: 'a/pet.json' }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: { happy: 'cheer' } }),
    readSoul: () => null,
  });
  expect(registry.get('a').soul).toBe(FALLBACK_SOUL);
  expect(registry.get('a').intents).toEqual(['happy']);
});

test('buildPetRegistry uses the real soul when readSoul returns text', () => {
  const petsIndex = { pets: [{ id: 'a', renderers: ['webm'], path: 'a/pet.json' }] };
  const registry = buildPetRegistry(petsIndex, {
    readManifest: () => ({ intentMap: {} }),
    readSoul: () => '专属人设文本',
  });
  expect(registry.get('a').soul).toBe('专属人设文本');
});
