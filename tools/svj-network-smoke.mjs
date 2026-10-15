import {createGameServer} from '../server/index.mjs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const app=await createGameServer({root:resolve('.'),dataDir:resolve('.scratch/svj/smoke-data')});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
try{const p=spawn(process.execPath,['tools/deploy-smoke.mjs',`http://127.0.0.1:${app.server.address().port}`,'--race'],{stdio:'inherit'});const code=await new Promise(r=>p.on('exit',r));if(code)process.exitCode=code;}finally{await app.close();}
