// index.js — 渲染器汇总。import 即完成注册。
// three / gltf 依赖 three（importmap 或打包器），模块内部动态 import；这里只做注册。
import './webm.js';
import './gif.js';
import './spritesheet.js';
import './pixel.js';
import './svg.js';
import './three.js';
import './gltf.js';

export { RendererBase, RENDERERS, createRenderer, registerRenderer } from './renderer-base.js';
