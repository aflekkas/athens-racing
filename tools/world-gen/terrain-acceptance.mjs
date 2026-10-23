// Geographic evidence is an additional publication prerequisite. It never
// replaces physical/contact guards or enables releaseReady on a local bake.
export const TERRAIN_FIELD = Object.freeze({schema:1,id:'binomial-9x32m-prototype',geographyVerified:false,maxPrototypeCells:27});
export function requireTerrainAcceptance(count,{field=TERRAIN_FIELD,sourceRevision,fieldSHA256,report}={}){
 if(count<=field.maxPrototypeCells)return {prototype:true};
 if(!field.geographyVerified)throw Error('Global terrain bake blocked: prototype field has not preserved actual hill profiles');
 if(report?.schema!=='terrain-geographic-acceptance-1'||report.sourceRevision!==sourceRevision||report.fieldSHA256!==fieldSHA256||report.fieldId!==field.id||report.passed!==true)throw Error('Global terrain bake requires an exact-source/exact-field hill and city acceptance report');
 for(const key of ['hillProfiles','cityComfort','negativeControls','protectedRegions'])if(report[key]?.passed!==true||!Number.isInteger(report[key].samples)||report[key].samples<1)throw Error('Missing measured terrain acceptance: '+key);
 if(report.cityComfort.maxSagLimit!==.5||report.negativeControls.rollerCoasterRejected!==true||report.protectedRegions.changedCells!==0)throw Error('Terrain acceptance cannot relax comfort or alter protected regions');
 if(!Array.isArray(report.hillProfiles.locations)||!['lycabettus','penteli','valley','world-edge'].every(k=>report.hillProfiles.locations.includes(k)))throw Error('Terrain acceptance requires summit, valley and edge profiles');
 return {prototype:false,report};
}
