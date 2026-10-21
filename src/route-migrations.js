import {canonicalCarId} from './car-ids.js';
// Reviewed Faros v3 bindings only. Garden/pre-garden records never enter the current board.
// Directed world lanes change length/contact/progress; equivalence has NOT been established.
export const ROUTE_MIGRATIONS=Object.freeze(['psychiko-race','psychiko-tt'].map(eventId=>Object.freeze({legacyMapId:'psychiko',legacyEventId:eventId,legacyTrackVersion:'75a42bf0',legacySuffix:'faros-v3',routeId:'psychiko-faros',eventId,direction:1,edition:'legacy-faros-v3',compatibility:'historical'})));
export const routeEdition=compiled=>compiled.id==='syntagma-pilot'?'pilot-v1:'+compiled.geometryHash:'world-lanes-v1:'+compiled.geometryHash;
export function resolveLegacyRoute({mapId,eventId,trackVersion,suffix=''}) {
 return ROUTE_MIGRATIONS.find(m=>m.legacyMapId===mapId&&m.legacyEventId===eventId&&m.legacyTrackVersion===trackVersion&&m.legacySuffix===suffix)||null;
}
export function legacySignature(record,{key='',trackVersion,suffix}={}) {
 const eventId=record.setup?.event||record.eventId||key.match(/psychiko-(?:race|tt)/)?.[0],mapId=record.setup?.map||record.mapId||(eventId?.startsWith('psychiko-')?'psychiko':null);
 const version=String(trackVersion||record.trackVersion||record.version||''),parts=version.split(':');
 return {mapId,eventId,trackVersion:parts[0]||((key.endsWith('.faros-v3')||suffix==='faros-v3')?'75a42bf0':''),suffix:suffix??parts[1]??(key.endsWith('.faros-v3')?'faros-v3':key.endsWith('.garden-v2')?'garden-v2':'')};
}
export function recordIdentity(record,options={}) {
 if(record.routeId&&record.edition)return {routeId:record.routeId,eventId:record.setup?.event||record.eventId,edition:record.edition,compatibility:'current',direction:record.setup?.direction??record.direction,laps:record.setup?.laps??record.laps};
 const sig=legacySignature(record,options),binding=resolveLegacyRoute(sig);
 if(binding)return {routeId:binding.routeId,eventId:binding.eventId,edition:binding.edition,compatibility:binding.compatibility,direction:record.setup?.direction??binding.direction,...((record.setup?.laps??record.laps)!=null?{laps:record.setup?.laps??record.laps}:{}),legacy:sig};
 // Unversioned v1 personal-best rows cannot prove which Psychiko course was driven.
 if(sig.mapId==='psychiko'&&['psychiko-race','psychiko-tt'].includes(sig.eventId))return {routeId:'psychiko-faros',eventId:sig.eventId,edition:'legacy-psychiko:'+sig.trackVersion+':'+sig.suffix,compatibility:'historical',legacy:sig};
 return null;
}
const stable=(v)=>{if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v??null);};
export function migrateRouteRecord(record,{source='unknown',key='',...options}={}) {
 if(record?.migration?.version===2)return record;
 const identity=recordIdentity(record,{key,...options});if(!identity)return record;
 return {...record,car:record.car==null?record.car:canonicalCarId(record.car),...(record.setup?{setup:{...record.setup,...(record.setup.car?{car:canonicalCarId(record.setup.car)}:{})}}:{}),identity,
  migration:{version:2,id:stable([source,key,record.driverId??record.id??null,record.at??record.date??null,record.time??record.bestTime??null]),source,key,original:structuredClone(record)}};
}
export function migrateRouteRecords(entries,options={}) {return entries.map((record,i)=>migrateRouteRecord(record,{...options,key:options.keys?.[i]??record.migration?.key??record.id??stable([record.driverId,record.eventId,record.version,record.setup,record.time,record.at??record.date])}));}
export function routeHistory(entries,routeId){return migrateRouteRecords(entries).filter(r=>r.identity?.routeId===routeId&&r.identity.compatibility==='historical').sort((a,b)=>(a.time??a.bestTime??Infinity)-(b.time??b.bestTime??Infinity));}
export const effectiveSetupKey=setup=>stable(Object.fromEntries(['map','event','from','to','direction','laps','car','time','weather','traffic','rivals','police','policeLevel','busted','signals','tc','abs','steering','gearbox'].filter(k=>setup?.[k]!==undefined).map(k=>[k,k==='car'?canonicalCarId(setup[k]):setup[k]])));
export const competitiveRecordKey=record=>stable([record.routeId||record.setup?.routeId,record.edition||record.setup?.edition,record.eventId||record.setup?.event,record.setup?.direction,record.setup?.laps,canonicalCarId(record.car||record.setup?.car),effectiveSetupKey(record.setup)]);

/** Classify original ghosts without re-encoding frames or changing their storage keys. */
export function historicalGhostIdentity(lap){
 if(lap?.routeId)return null;
 const direct=recordIdentity(lap);if(direct?.compatibility==='historical')return direct;
 // Old PB ghost ids are hashes of the setup. The frozen Faros geometry version
 // and its exact positive whole-lap endpoints identify these originals instead.
 if(lap?.trackVersion!=='75a42bf0'||!['sprint','timetrial'].includes(lap.type))return null;
 const [from,to]=String(lap.routeKey).split('>').map(Number),laps=Math.round(to/5732.284334253607);
 if(from!==0||laps<1||laps>20||Math.abs(to-Math.round(laps*5732.284334253607))>.001)return null;
 return {routeId:'psychiko-faros',eventId:lap.type==='timetrial'?'psychiko-tt':'psychiko-race',edition:'legacy-faros-v3',compatibility:'historical',direction:1,laps};
}
