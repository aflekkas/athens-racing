// Exercise the real local transport without writing to a remote deployment.
import {createGameServer} from '../server/index.mjs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const app=await createGameServer({dataDir:resolve('.scratch/psychiko/smoke-data')});
await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
const url=`http://127.0.0.1:${app.server.address().port}`;
try {
 const child=spawn(process.execPath,['tools/deploy-smoke.mjs',url,'--race','--map=psychiko'],{stdio:'inherit'});
 const code=await new Promise(done=>child.once('exit',done));process.exitCode=code;
}finally{await app.close();}
