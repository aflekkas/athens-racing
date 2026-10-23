import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createProofEgress,pinnedThreeReader,FONT_CSS_URL,THREE_PREFIX,EGRESS_LAUNCH_ARGS,EGRESS_CONTEXT_OPTIONS} from './material-proof-egress.mjs';
const sha=body=>createHash('sha256').update(body).digest('hex');
let fetches=0,writes=0;const oldFetch=globalThis.fetch;globalThis.fetch=()=>{fetches++;throw Error('NO_FETCH_ALLOWED');};
after(()=>{globalThis.fetch=oldFetch;assert.equal(fetches,0);assert.equal(writes,0);});
const origin='http://127.0.0.1:8123';
function fixture(){
 const reads=[],body=Buffer.from('local Three body');
 const policy=createProofEgress({localOrigin:origin,dependency:{version:'0.170.0',packageJSONSHA256:'pinned'},readThree:async relative=>{reads.push(relative);return {relative,body,sha256:sha(body),contentType:'text/javascript'};}});
 const route=(url,method='GET')=>{const calls=[];return {calls,request:()=>({url:()=>url,method:()=>method,headers(){throw Error('Never read/forward credentials');}}),continue:async()=>calls.push(['continue']),fulfill:async options=>calls.push(['fulfill',options]),abort:async reason=>calls.push(['abort',reason]),fetch:()=>{fetches++;throw Error('NO_ROUTE_FETCH');},write:()=>{writes++;throw Error('NO_WRITE');}};};
 return {policy,route,reads,body};
}
test('only exact own origin continues; another loopback port is forbidden',async()=>{
 const {policy,route}=fixture(),allowed=route(origin+'/src/entry.js');await policy.handle(allowed);assert.deepEqual(allowed.calls,[['continue']]);assert.equal(policy.report.localRequests,1);
 const wrong=route('http://127.0.0.1:8124/src/entry.js');await policy.handle(wrong);assert.equal(wrong.calls[0][0],'abort');assert.equal(policy.report.firstCause.code,'UNAPPROVED_REMOTE');
});
test('Three CDN is fulfilled only from pinned read-only bytes without forwarding request headers',async()=>{
 const {policy,route,reads,body}=fixture(),request=route(THREE_PREFIX+'build/three.module.js');await policy.handle(request);
 assert.deepEqual(reads,['build/three.module.js']);assert.equal(request.calls[0][0],'fulfill');assert.deepEqual(request.calls[0][1].body,body);assert.equal(request.calls[0][1].headers['access-control-allow-origin'],origin);assert.equal(request.calls.length,1);
 assert.equal(policy.report.threeLocalFiles[0].sha256,sha(body));assert.equal(policy.report.threeLocalFiles[0].REMOTE_BYTES,0);policy.observeResponse(THREE_PREFIX+'build/three.module.js');assert.equal(policy.report.REMOTE_BYTES,0);
});
test('exact predeclared font CSS receives deterministic empty LOCAL CSS and capture provenance',async()=>{
 const {policy,route,reads}=fixture(),request=route(FONT_CSS_URL);await policy.handle(request);const [kind,result]=request.calls[0];
 assert.equal(kind,'fulfill');assert.equal(result.contentType,'text/css');assert.equal(result.body.length,0);assert.equal(result.status,200);assert.equal(reads.length,0);
 policy.assertCaptureReady();const record=policy.report.fontFallbacks[0];assert.equal(record.bodyBytes,0);assert.equal(record.sha256,sha(Buffer.alloc(0)));assert.equal(record.REMOTE_BYTES,0);assert.match(record.provenance,/both fresh builds/);
 policy.observeResponse(FONT_CSS_URL);assert.equal(policy.report.REMOTE_BYTES,0);
});
test('only predeclared Barlow font file requests are expected blocks, never fetched',async()=>{
 const {policy,route}=fixture(),url='https://fonts.gstatic.com/s/barlow/v12/AbCd_12-xy.woff2',expected=route(url);
 assert.equal(policy.isExpectedBlock(url),false);await policy.handle(expected);assert.deepEqual(expected.calls,[['abort','blockedbyclient']]);assert.equal(policy.isExpectedBlock(url),true);assert.equal(policy.fatal,null);assert.equal(policy.report.expectedFontBlocks.length,1);
 const other=route('https://fonts.gstatic.com/s/unapproved/v1/font.woff2');await policy.handle(other);assert.equal(policy.report.firstCause.code,'UNAPPROVED_REMOTE');
});
test('unapproved remote aborts, redacts credentials and latches first cause before ANY later commands',async()=>{
 const {policy,route}=fixture(),raw='https://private-user:private-pass@example.org/secret-path?token=private-token',request=route(raw);await policy.handle(request);
 assert.deepEqual(request.calls,[['abort','blockedbyclient']]);assert.equal(policy.report.firstCause.code,'EGRESS_URL_OR_CREDENTIALS');
 let commands=0;const page=policy.guardPage({evaluate(){commands++;},goto(){commands++;},close(){return 'cleanup';}});
 await assert.rejects(page.evaluate(()=>1),/EGRESS_URL_OR_CREDENTIALS/);await assert.rejects(page.goto(origin),/EGRESS_URL_OR_CREDENTIALS/);assert.equal(commands,0);assert.equal(page.close(),'cleanup');
 const second=route('https://other.example/');await policy.handle(second);assert.equal(policy.report.firstCause.code,'EGRESS_URL_OR_CREDENTIALS');assert.equal(policy.report.failures.length,1);
 const output=JSON.stringify(policy.report)+policy.safeMessage('blocked '+raw);for(const secret of ['private-user','private-pass','secret-path','private-token'])assert.ok(!output.includes(secret),'never retain URL credentials/query/path secrets');
});
test('forbidden remote interrupts an in-flight command and prevents subsequent command issuance',async()=>{
 const {policy,route}=fixture();let go=0,later=0,finish;
 const page=policy.guardPage({goto(){go++;return new Promise(resolve=>{finish=resolve;});},evaluate(){later++;}});
 const navigation=page.goto(origin);await Promise.resolve();assert.equal(go,1);
 await policy.handle(route('https://unapproved.example/file.js'));
 await assert.rejects(navigation,/UNAPPROVED_REMOTE/);await assert.rejects(page.evaluate(()=>1),/UNAPPROVED_REMOTE/);assert.equal(later,0);finish();
});
test('missing or duplicate font fallback stops capture rather than silently changing font behavior',async()=>{
 const first=fixture();assert.throws(()=>first.policy.assertCaptureReady(),/FONT_FALLBACK_NOT_EXACTLY_ONCE/);
 const second=fixture();await second.policy.handle(second.route(FONT_CSS_URL));await second.policy.handle(second.route(FONT_CSS_URL));assert.throws(()=>second.policy.assertCaptureReady(),/FONT_FALLBACK_NOT_EXACTLY_ONCE/);
});
test('unexpected remote responses fail with REMOTE_BYTES unknown rather than claiming zero',()=>{
 const {policy}=fixture();policy.observeResponse('https://unrouted.example/file');assert.equal(policy.report.REMOTE_BYTES,null);assert.equal(policy.report.firstCause.code,'UNROUTED_REMOTE_RESPONSE');
});
test('page/shader/HTTP failures stay fatal even when fonts have their expected fallback',async()=>{
 for(const code of ['PAGE_ERROR','WEBGL_SHADER_ERROR','HTTP_FAILURE','REQUEST_FAILED']){
  const {policy,route}=fixture();await policy.handle(route(FONT_CSS_URL));policy.fail(code,origin+'/src/entry.js');let commands=0;
  await assert.rejects(policy.execute(()=>commands++),new RegExp(code));assert.equal(commands,0);
 }
});
test('remote WebSockets never connect; only own local socket may connect',async()=>{
 const {policy}=fixture();let connections=0,closed=0;await policy.socket({url:()=> 'ws://127.0.0.1:8123/ws',connectToServer(){connections++;}});assert.equal(connections,1);
 await policy.socket({url:()=> 'wss://private-user:private-pass@example.org/ws?secret=private-token',connectToServer(){connections++;},close(){closed++;}});assert.equal(connections,1);assert.equal(closed,1);assert.equal(policy.report.firstCause.code,'UNAPPROVED_WEBSOCKET');assert.ok(!JSON.stringify(policy.report).includes('private-token'));
});
test('Three reader pins version/body, rejects traversal/symlink escape and changed bytes without writes',async()=>{
 const files=new Map([['/deps/package.json',Buffer.from('{"version":"0.170.0"}')],['/deps/build/three.module.js',Buffer.from('pinned')]]),calls=[];
 const io={canonical:async path=>path,read:async path=>{calls.push(path);if(!files.has(path))throw Error('Missing file');return files.get(path);}};
 const reader=await pinnedThreeReader('/deps',io);assert.equal(reader.dependency.version,'0.170.0');assert.equal((await reader.load('build/three.module.js')).sha256,sha(Buffer.from('pinned')));
 await assert.rejects(reader.load('../secret'),/THREE_PATH/);files.set('/deps/build/three.module.js',Buffer.from('changed'));await assert.rejects(reader.load('build/three.module.js'),/THREE_BODY_CHANGED/);
 const escape=await pinnedThreeReader('/deps',{...io,canonical:async path=>path.endsWith('escape')?'/secret':path});await assert.rejects(escape.load('escape'),/THREE_PATH_ESCAPE/);assert.ok(!calls.includes('/secret'));
 files.set('/deps/package.json',Buffer.from('{"version":"0.171.0"}'));await assert.rejects(pinnedThreeReader('/deps',io),/THREE_PACKAGE_VERSION_PIN/);
});
test('DNS/serviceworker guards are explicit; remote methods/query variants never access Three',async()=>{
 assert.deepEqual(EGRESS_CONTEXT_OPTIONS,{serviceWorkers:'block'});assert.match(EGRESS_LAUNCH_ARGS[0],/MAP \* ~NOTFOUND/);
 for(const url of ['https://elsewhere.example','http://user:pass@127.0.0.1:8123'])assert.throws(()=>createProofEgress({localOrigin:url}),/OWN_LOOPBACK_ORIGIN_REQUIRED/);
 for(const [url,method] of [[THREE_PREFIX+'build/three.module.js?token=secret','GET'],[THREE_PREFIX+'build/three.module.js','POST'],[FONT_CSS_URL+'&extra=1','GET']]){const f=fixture(),request=f.route(url,method);await f.policy.handle(request);assert.equal(request.calls[0][0],'abort');assert.equal(f.reads.length,0);}
 const source=await readFile(new URL('./material-proof-egress.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\b(?:writeFile|appendFile|createWriteStream)\b/,'policy exposes no filesystem write path');
});

// Cleanup is allowed after a failure, but must never turn a failed run into PASS.
test('a failure during page cleanup is still latched before any next case',async()=>{
 const {policy}=fixture();let later=0;const page=policy.guardPage({close(){policy.fail('REQUEST_FAILED',origin+'/pending-cell');},goto(){later++;}});
 await page.close();assert.throws(policy.check,/REQUEST_FAILED/);await assert.rejects(page.goto(origin),/REQUEST_FAILED/);assert.equal(later,0);
});
