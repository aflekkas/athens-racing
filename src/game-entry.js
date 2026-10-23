// Reached only after entry.js's desktop gate and unchanged parallel prefetches.
// Keep this static graph free of simulation, rendering and race/menu imports.
import {freeRoamEntryQuery} from './free-roam-entry.js';
import {importWithUpdate} from './client-release.js';
import {createTileObservationForDebug} from './world-tile-observation.js';
const query=new URLSearchParams(location.search),freeEntry=freeRoamEntryQuery(query);
export let gameReady;
if(freeEntry){
 const tileObserver=query.has('simhook')&&query.get('tileLifecycle')==='1'?createTileObservationForDebug(query):null;
 history.replaceState(null,'','?'+freeEntry);
 gameReady=importWithUpdate(()=>import('./athens-world.js')).then(module=>module.bootAthens({tileObserver}));
}else{
 // The production bundler redirects this one import to boot.js for its menu.
 // boot.js's later simulation import and main.js's compatibility API stay intact.
 gameReady=importWithUpdate(()=>import('./main.js')).then(module=>module.gameReady);
}
