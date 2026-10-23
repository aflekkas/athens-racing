import {snapshotJSONForAuthentication} from './json-auth-snapshot.js';
// Keep the grid wire cap fixed; callers may only tighten its phase budget.
export const snapshotOnlineGrid=(value,{maxCombinedBytes=12*1024*1024}={})=>snapshotJSONForAuthentication(value,{maxCombinedBytes,maxWireBytes:128*1024});
