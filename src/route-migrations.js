import {canonicalCarId} from './car-ids.js';
// Only reviewed concrete course signatures acquire aliases. Unknown versions and garden-v2 remain in their original stores.
// Directed world lanes change length/contact/progress; equivalence has NOT been established.
export const ROUTE_MIGRATIONS=Object.freeze([...['psychiko-race','psychiko-tt'].map(eventId=>Object.freeze({legacyMapId:'psychiko',legacyEventId:eventId,legacyTrackVersion:'75a42bf0',legacySuffix:'faros-v3',routeId:'psychiko-faros',eventId,direction:1,edition:'legacy-faros-v3',compatibility:'historical'})),...['quick','riviera-sprint','tt-riviera'].map(eventId=>Object.freeze({legacyMapId:'riviera',legacyEventId:eventId,legacyTrackVersion:'4718fbec',legacySuffix:'',routeId:'riviera-coast',eventId,direction:1,edition:'legacy-riviera-4718fbec',compatibility:'historical'})),...['penteli-race','penteli-tt','penteli-descent-tt'].map(eventId=>Object.freeze({legacyMapId:'penteli',legacyEventId:eventId,legacyTrackVersion:'33ed3ce1',legacySuffix:'',routeId:eventId==='penteli-descent-tt'?'penteli-descent':'penteli-hill',eventId,direction:eventId==='penteli-descent-tt'?-1:1,edition:'legacy-penteli-33ed3ce1',compatibility:'historical'}))]);
export const routeEdition=compiled=>compiled.id==='syntagma-pilot'?'pilot-v1:'+compiled.geometryHash:'world-lanes-v1:'+compiled.geometryHash;
export function resolveLegacyRoute({mapId,eventId,trackVersion,suffix=''}) {
 return ROUTE_MIGRATIONS.find(m=>m.legacyMapId===mapId&&m.legacyEventId===eventId&&m.legacyTrackVersion===trackVersion&&m.legacySuffix===suffix)||null;
}
export function legacySignature(record,{key='',trackVersion,suffix}={}) {
 const eventId=record.setup?.event||record.eventId||key.match(/(?:^|\.events\.)(psychiko-(?:race|tt)|penteli-(?:descent-tt|race|tt)|riviera-sprint|tt-riviera|quick)(?=\.|$)/)?.[1],mapId=record.setup?.map||record.mapId||(eventId?.startsWith('psychiko-')?'psychiko':eventId?.startsWith('penteli-')?'penteli':['quick','riviera-sprint','tt-riviera'].includes(eventId)?'riviera':null);
 const version=String(trackVersion||record.trackVersion||record.version||''),parts=version.split(':');
 return {mapId,eventId,trackVersion:parts[0]||((key.endsWith('.faros-v3')||suffix==='faros-v3')?'75a42bf0':''),suffix:suffix??parts[1]??(key.endsWith('.faros-v3')?'faros-v3':key.endsWith('.garden-v2')?'garden-v2':'')};
}
export function recordIdentity(record,options={}) {
 if(!record||typeof record!=='object')return null;
 if(record.routeId&&record.edition)return {routeId:record.routeId,eventId:record.setup?.event||record.eventId,edition:record.edition,compatibility:'current',direction:record.setup?.direction??record.direction,laps:record.setup?.laps??record.laps};
 const sig=legacySignature(record,options),binding=resolveLegacyRoute(sig);
 if(binding&&binding.routeId==='riviera-coast'&&record.setup?.from!=null&&record.setup?.to!=null&&![[241,10548],[10548,241]].some(([from,to])=>Math.abs(record.setup.from-from)<.002&&Math.abs(record.setup.to-to)<.002))return null;
 if(binding?.legacyMapId==='penteli'){const endpoints=binding.direction===-1?[10188,292]:[292,10188];if(record.setup?.from!=null||record.setup?.to!=null){if(!endpoints.every((v,i)=>Math.abs((i?record.setup.to:record.setup.from)-v)<.002))return null;}if(record.routeKey!=null&&record.routeKey!==endpoints.join('>'))return null;if((record.setup?.direction??record.direction??binding.direction)!==binding.direction)return null;}
 if(binding)return {routeId:binding.routeId,eventId:binding.eventId,edition:binding.edition,compatibility:binding.compatibility,direction:record.setup?.direction??record.direction??(record.routeKey==='10548>241'?-1:binding.direction),...((record.setup?.laps??record.laps)!=null?{laps:record.setup?.laps??record.laps}:{}),legacy:sig};
 return null;
}
const stable=(v)=>{if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v??null);};
export function migrateRouteRecord(record,{source='unknown',key='',...options}={}) {
 if(record?.migration?.version===2){const identity=recordIdentity(record.migration.original,{key:record.migration.key,...options});return identity?{...record,identity}:structuredClone(record.migration.original);}
 const identity=recordIdentity(record,{key,...options});if(!identity)return record;
 return {...record,car:record.car==null?record.car:canonicalCarId(record.car),...(record.setup?{setup:{...record.setup,...(record.setup.car?{car:canonicalCarId(record.setup.car)}:{})}}:{}),identity,
  migration:{version:2,id:stable([source,key,record.driverId??record.id??null,record.at??record.date??null,record.time??record.bestTime??null]),source,key,original:structuredClone(record)}};
}
export function migrateRouteRecords(entries,options={}) {return entries.map((record,i)=>migrateRouteRecord(record,{...options,key:options.keys?.[i]??record.migration?.key??record.id??stable([record.driverId,record.eventId,record.version,record.setup,record.time,record.at??record.date])}));}
export const historicalEdition=routeId=>ROUTE_MIGRATIONS.find(m=>m.routeId===routeId)?.edition;
// Edition keys belong to storage and compatibility checks, never player-facing copy.
const HISTORICAL_EDITION_LABELS=Object.freeze({'legacy-faros-v3':'Original Faros circuit','legacy-riviera-4718fbec':'Original Riviera track','legacy-penteli-33ed3ce1':'Original Penteli road'});
export const historicalEditionLabel=edition=>Object.hasOwn(HISTORICAL_EDITION_LABELS,edition)?HISTORICAL_EDITION_LABELS[edition]:'Earlier course';
export function routeHistory(entries,routeId,{edition=historicalEdition(routeId)}={}){return migrateRouteRecords(entries).filter(r=>r.identity?.routeId===routeId&&r.identity.compatibility==='historical'&&r.identity.edition===edition).sort((a,b)=>(a.time??a.bestTime??Infinity)-(b.time??b.bestTime??Infinity));}
export const effectiveSetupKey=setup=>stable(Object.fromEntries(['map','event','from','to','direction','laps','car','time','weather','traffic','rivals','police','policeLevel','busted','signals','tc','abs','steering','gearbox'].filter(k=>setup?.[k]!==undefined).map(k=>[k,k==='car'?canonicalCarId(setup[k]):setup[k]])));
export const competitiveRecordKey=record=>stable([record.routeId||record.setup?.routeId,record.edition||record.setup?.edition,record.eventId||record.setup?.event,record.setup?.direction,record.setup?.laps,canonicalCarId(record.car||record.setup?.car),effectiveSetupKey(record.setup)]);

/** Classify original ghosts without re-encoding frames or changing their storage keys. */
export function historicalGhostIdentity(lap){
 if(lap?.routeId)return null;
 const direct=recordIdentity(lap);if(direct?.compatibility==='historical')return direct;
 // Old PB ghost ids are hashes of the setup. The frozen Faros geometry version
 // and its exact positive whole-lap endpoints identify these originals instead.
 if(lap?.trackVersion==='33ed3ce1'&&['sprint','timetrial'].includes(lap.type)&&['292>10188','10188>292'].includes(lap.routeKey)){const descent=lap.routeKey==='10188>292';if(descent&&lap.type!=='timetrial')return null;return {routeId:descent?'penteli-descent':'penteli-hill',eventId:descent?'penteli-descent-tt':lap.type==='timetrial'?'penteli-tt':'penteli-race',edition:'legacy-penteli-33ed3ce1',compatibility:'historical',direction:descent?-1:1,laps:1};}
 if(lap?.trackVersion==='4718fbec'&&['sprint','timetrial'].includes(lap.type)&&lap.routeKey==='241>10548')return {routeId:'riviera-coast',eventId:lap.type==='timetrial'?'tt-riviera':'quick',edition:'legacy-riviera-4718fbec',compatibility:'historical',direction:1,laps:1};
 if(lap?.trackVersion!=='75a42bf0'||!['sprint','timetrial'].includes(lap.type))return null;
 const [from,to]=String(lap.routeKey).split('>').map(Number),laps=Math.round(to/5732.284334253607);
 if(from!==0||laps<1||laps>20||Math.abs(to-Math.round(laps*5732.284334253607))>.001)return null;
 return {routeId:'psychiko-faros',eventId:lap.type==='timetrial'?'psychiko-tt':'psychiko-race',edition:'legacy-faros-v3',compatibility:'historical',direction:1,laps};
}
