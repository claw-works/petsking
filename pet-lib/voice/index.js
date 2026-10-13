// pet-lib/voice/index.js — 语音层出口（也可单独 import '@claw-works/pet-lib/voice'）
export { Voice } from './voice.js';
export { AudioLipSync } from './lipsync.js';
export { mouthFeatures } from './mouth-features.js';
export { browserTts, cancelBrowserTts } from './tts.js';
export { loadVoicePack, createVoicePack } from './voice-pack.js';
export { VISEMES, charToViseme, textToVisemeTimeline, visemeAt } from './visemes.js';
