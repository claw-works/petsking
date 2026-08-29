// core/index.js — 驱动汇总。import 即注册。
import './chain-driver.js';
import './state-driver.js';
export { DriverBase, DRIVERS, createDriver, registerDriver } from './driver-base.js';
export { resolveEvent, SEMANTIC_PRIORITY } from './state-driver.js';
