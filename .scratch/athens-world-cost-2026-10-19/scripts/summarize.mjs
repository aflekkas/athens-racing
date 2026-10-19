// Aggregate a bake's audit lines into the numbers the evidence README quotes.
// node summarize.mjs BAKE_DIR(b) OUT.json   (reads audit.ndjson, python-audit.ndjson, summary.json, cells/manifest.json)
import {readFileSync,writeFileSync} from 'node:fs';
const [dir,out]=process.argv.slice(2);
const lines=f=>readFileSync(dir+'/'+f,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const A=lines('audit.ndjson'),P=lines('python-audit.ndjson').filter(x=>x.cell),S=JSON.parse(readFileSync(dir+'/summary.json')),M=JSON.parse(readFileSync(dir+'/cells/manifest.json'));
const sum=(xs,f)=>xs.reduce((n,x)=>n+(f(x)||0),0),max=(xs,f)=>Math.max(...xs.map(f)),MiB=n=>Math.round(n/1048576*10)/10;
const tiles=Object.values(M.tiles);
const gates={asphaltTriangles:sum(A,a=>a.physical.asphaltTriangles),asphaltAbove30:sum(A,a=>a.physical.asphaltAbove30),maxAsphaltDegrees:+max(A,a=>a.physical.maxAsphaltDegrees).toFixed(2),
 shoulderSamples:sum(A,a=>a.physical.shoulderSamples),maxShoulderStepCm:+(100*max(A,a=>a.physical.maxShoulderStep)).toFixed(2),maxShoulderDegrees:+max(A,a=>a.physical.maxShoulderDegrees).toFixed(2),
 missingContacts:sum(A,a=>a.physical.missingContacts),maxProfileGrade:+max(A,a=>a.physical.maxProfileGrade).toFixed(3),
 bridgeEdgeSamples:sum(A,a=>a.bridges.edgeSamples),bridgeUnguarded:sum(A,a=>a.bridges.unguarded),clearanceSamples:sum(A,a=>a.bridges.clearanceSamples),clearanceBlocked:sum(A,a=>a.bridges.blocked),
 minClearanceM:+Math.min(...A.filter(a=>a.bridges.clearanceSamples).map(a=>a.bridges.minClearance)).toFixed(2),unsafeAnchors:sum(A,a=>a.bridges.unsafeAnchors),cellsWithDecks:A.filter(a=>a.bridges.edgeSamples>0).length,
 junctionsChecked:sum(P,p=>p.streets.junctionsChecked),junctionHoles:sum(P,p=>p.streets.junctionHoles),overlapArea:sum(P,p=>p.streets.overlapArea),sidewalkSamples:sum(P,p=>p.streets.sidewalkSamples),sidewalkMissing:sum(P,p=>p.streets.sidewalkMissing),zebras:sum(P,p=>p.streets.zebras),fillets:sum(P,p=>p.streets.fillets)};
const total=sum(tiles,t=>t.bytes);
const result={world:S.world,cells:tiles.length,compressedBytes:total,compressedMiB:MiB(total),ceilingMiB:192,headroomMiB:MiB(192*1048576-total),meanCellBytes:Math.round(total/tiles.length),largestCellBytes:max(tiles,t=>t.bytes),
 meanResidentBytes:Math.round(sum(tiles,t=>t.residentBytes)/tiles.length),largestResidentBytes:max(tiles,t=>t.residentBytes),
 worst2x2SafetyMiB:MiB(S.maxSafetyBytes),worst2x2SafetyCell:S.worstSafetyCell,phoneCapMiB:64,worst3x3NeighbourhoodMiB:MiB(S.maxNeighbourhoodBytes),maxTransientMiB:MiB(S.maxTransientBytes),
 triangles:sum(tiles,t=>t.triangles),graph:{directedEdges:S.graphEdges,nodes:S.graphNodes,turnRules:S.turnRules,towAnchors:sum(A,a=>a.anchors)},gates,
 structures:{excludedRoads:S.excludedRoads,excludedByReason:S.excludedByReason,unresolvedBridges:S.unresolvedBridges.length,atGradeUnderpasses:S.atGradeUnderpasses},
 clippedBuildingPieces:S.clippedBuildingPieces,clippedBuildingPiecesDropped:S.clippedBuildingPiecesDropped,generatorCpuSeconds:Math.round(sum(P,p=>p.seconds))};
writeFileSync(out,JSON.stringify(result,null,1)+'\n');console.log(JSON.stringify({cells:result.cells,MiB:result.compressedMiB,headroom:result.headroomMiB,worst2x2:result.worst2x2SafetyMiB,largestResident:result.largestResidentBytes,mean:result.meanCellBytes,gates:gates.asphaltAbove30+'/'+gates.missingContacts+'/'+gates.bridgeUnguarded+'/'+gates.clearanceBlocked}));
