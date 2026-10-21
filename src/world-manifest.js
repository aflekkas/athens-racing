import {validateWorldManifest} from './world-tile-format.js';
export const ATHENS_PROJECTION=Object.freeze({lat0:37.98,lon0:23.73,metresPerLat:111320,metresPerLon:111320*Math.cos(37.98*Math.PI/180)});
/** Phase 1 is deliberately a single source; attached regions are a later migration. */
export function validateWorldDefinition(def){const manifest=validateWorldManifest(def.manifest||def);if(def.id&&def.id!=='athens')throw Error('Unknown world');if(def.worldSetRevision&&def.worldSetRevision!==manifest.revision)throw Error('World release mismatch');return {id:'athens',regionId:'basin',worldSetRevision:manifest.revision,manifest,manifestURL:def.manifestURL};}
