import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fetchTilePacket} from '/tmp/athens-world-generator/src/world-tile-worker.js';
const cache='/tmp/athens-world-cache/';
const entries={};for(const [label,folder]of [['before','ground-probe'],['after','ground-probe-packed']]){const e=Object.values(JSON.parse(await readFile(cache+folder+'/entries.json','utf8')).tiles)[0];entries[label]={entry:e,bytes:await readFile(cache+folder+'/'+e.url)};}
const server=http.createServer((req,res)=>{const data=entries[req.url.slice(1)];if(!data){res.writeHead(404);res.end();return;}res.end(data.bytes);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const result={};
try{for(const label of ['before','after']){const {entry}=entries[label];const start=process.cpuUsage();const p=await fetchTilePacket({url:'http://127.0.0.1:'+server.address().port+'/'+label,entry,world:'athens-probe',revision:'ground-probe-style-2',cell:[4,25]});const cpu=process.cpuUsage(start);result[label]={residentBytes:p.bytes,gpuBytes:p.gpuBytes,contactIndexBytes:p.contactIndex.offsets.byteLength+p.contactIndex.refs.byteLength,contactReferences:p.contactIndex.refs.length,cpuSeconds:(cpu.user+cpu.system)/1e6};}}
finally{await new Promise(r=>server.close(r));}
await writeFile('/tmp/athens-world-generator/.scratch/athens-world/packing-worker-check.json',JSON.stringify({purpose:'Actual fetchTilePacket hash/decode/index/bounds/accounting path, same local tile and current runtime for both encodings.',runtimeBase:'bdac8c5023c2a7ad70f3544fe5c1105014d4d92e',...result},null,2)+'\n');console.log(JSON.stringify(result));
