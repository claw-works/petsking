// index.js — 渲染器汇总。import 即完成注册。
// three 因依赖 CDN 懒加载，按需 import；这里静态注册轻量的几种。
import './webm.js';
import './gif.js';
import './spritesheet.js';
import './pixel.js';
import './svg.js';
import './three.js';

export { RendererBase, RENDERERS, createRenderer, registerRenderer } from './renderer-base.js';
