// Per-cell gate for the generated road cross-sections (docs/world-roads.md). Reads the cell's roadSections
// metadata, written by tools/world-gen/tiles.py from the same table as tools/world-gen/road_section.py.
import {readFileSync} from 'node:fs';
import {PSYCHIKO_CLASSES} from '../src/maps/psychiko-streets.js';
const table=JSON.parse(readFileSync(new URL('./world-gen/fixtures/road-classes.json',import.meta.url),'utf8'));
export const ROAD_CLASSES=table.classes;
const SURFACES=new Set(['asphalt','concrete','paving','unpaved']);
/** Returns {passed,problems,...stats}. A road in the cell must sit inside its class band, share its class/lane width
 * with every other road of that class and lane count, and have sidewalk meshes wherever it has a sidewalk. */
export function auditRoadSections(m){
  const problems=[],rs=m.roadSections;
  if(!rs||!Array.isArray(rs.schema)||typeof rs.roads!=='object')return {passed:false,problems:['roadSections missing'],roads:0};
  const col=Object.fromEntries(rs.schema.map((k,i)=>[k,i])),widths=new Map(),byClass={};let sidewalkRoads=0,outsideBand=0;
  const ids=new Set(m.ids);
  for(const [id,row] of Object.entries(rs.roads)){
    const klass=ROAD_CLASSES[row[col.class]];
    if(!klass){problems.push(`${id}: unknown class ${row[col.class]}`);continue;}
    const width=row[col.width],lanes=row[col.lanes],left=row[col.sidewalkLeft],right=row[col.sidewalkRight];
    byClass[row[col.class]]=(byClass[row[col.class]]||0)+1;
    if(!ids.has('surface:'+id))problems.push(`${id}: no surface in the cell`);
    const survey=row[col.surveyClass],reviewed=survey?PSYCHIKO_CLASSES[survey]:null;
    if(survey&&(!reviewed||width!==reviewed.w||left!==reviewed.footway||right!==reviewed.footway))problems.push(`${id}: invalid Psychiko surveyed section`);
    if(!reviewed&&!(width>=klass.minWidth-1e-6&&width<=klass.maxWidth+1e-6)){outsideBand++;problems.push(`${id}: width ${width} outside ${row[col.class]} band ${klass.minWidth}-${klass.maxWidth}`);}
    if(!Number.isInteger(lanes)||lanes<1||lanes>16)problems.push(`${id}: lanes ${lanes}`);
    if(!SURFACES.has(row[col.surface]))problems.push(`${id}: surface ${row[col.surface]}`);
    for(const w of [left,right])if(w!==0&&!reviewed&&!(w>=table.sidewalkRange[0]&&w<=table.sidewalkRange[1]))problems.push(`${id}: sidewalk ${w}`);
    if(left>0||right>0)sidewalkRoads++;
    // Same class + lane count + direction => one width (a tagged `width` is the only allowed exception: it lies on a lane multiple).
    const key=`${row[col.class]}/${lanes}/${row[col.oneway]!==0}`,set=widths.get(key)||new Set();set.add(width);widths.set(key,set);
  }
  const surfaces=new Set(m.meshes.map(x=>x.userData?.tileSurface));
  if(sidewalkRoads&&!m.meshes.some(x=>x.material===8&&x.userData?.tileSurface==='paving'))problems.push('sidewalk roads without a paving mesh');
  if(sidewalkRoads&&!m.meshes.some(x=>x.material===9))problems.push('sidewalk roads without a kerb mesh');
  if(Object.keys(rs.roads).length&&!surfaces.has('asphalt')&&!surfaces.has('paving')&&![...Object.values(rs.roads)].every(r=>r[col.surface]==='unpaved'))problems.push('roads without a textured carriageway mesh');
  return {passed:!problems.length,problems:problems.slice(0,20),roads:Object.keys(rs.roads).length,byClass,sidewalkRoads,outsideBand,distinctWidthsPerClassAndLanes:Object.fromEntries([...widths].map(([k,v])=>[k,[...v].sort((a,b)=>a-b)]))};
}
