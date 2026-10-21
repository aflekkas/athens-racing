import {resolve} from 'node:path';
import {checkBuiltRouteRelease} from './route-release.mjs';

const result = await checkBuiltRouteRelease(resolve(import.meta.dirname, '..'), process.env.ASR_BUILD_ENV || 'staging');
console.log(JSON.stringify(result));
