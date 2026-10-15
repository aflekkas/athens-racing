import {register} from 'node:module';
register('./baseline-hooks.mjs',import.meta.url);
export const {Vehicle:Before}=await import('./physics-before.js');
