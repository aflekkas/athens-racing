import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPassiveTrace,traceURL} from './material-proof-trace.mjs';
import {createProofEgress} from './material-proof-egress.mjs';
const origin='http://127.0.0.1:8123',auth=origin+'/api/auth/session';
const sha=s=>createHash('sha256').update(s).digest('hex');
let fetches=0;const oldFetch=globalThis.fetch;globalThis.fetch=()=>{fetches++;throw Error('NO_FETCH');};after(()=>{globalThis.fetch=oldFetch;assert.equal(fetches,0);});
const forbidden=()=>{throw Error('FORBIDDEN_BODY_HEADER_COOKIE_ACCESS');};
function request(url=auth,{navigation=false,error='net::ERR_ABORTED'}={}){
 const r={url:()=>url,method:()=> 'GET',resourceType:()=>navigation?'document':'fetch',isNavigationRequest:()=>navigation,timing:()=>({startTime:123,requestStart:5,responseStart:8,secret:'DO_NOT_KEEP'}),failure:()=>({errorText:error})};
 for(const name of ['headers','allHeaders','headerValue','postData','postDataBuffer','response','body','text','json','cookies'])r[name]=forbidden;
 return r;
}
function cdpRequest(requestId='7',url=auth){return{requestId,frameId:'frame-1',loaderId:'loader-1',timestamp:10,wallTime:1700,type:'Fetch',request:{url,method:'GET',get headers(){return forbidden();},get postData(){return forbidden();}},initiator:{type:'script',stack:{callFrames:[{url:origin+'/src/entry.js?token=secret-query',lineNumber:10,columnNumber:20,functionName:'secret-function'}]}}};}
function fixture(options={}){
 let tick=0;const trace=createPassiveTrace({localOrigin:origin,clock:()=>++tick,...options});
 const page=new EventEmitter(),session=new EventEmitter(),calls=[];
 const frame={url:()=>origin+'/?secret=query'};page.mainFrame=()=>frame;
 page.context=()=>({newCDPSession:async p=>{assert.equal(p,page);return session;}});
 session.send=async name=>calls.push(name);
 for(const name of ['goto','addInitScript','evaluate','waitForFunction','close'])page[name]=async(...args)=>{calls.push(name);if(name==='goto'){page.emit('framenavigated',frame);page.emit('domcontentloaded');page.emit('load');}if(name==='close')page.emit('close');return args[0];};
 return{trace,page,session,calls};
}
test('redacts credentials/query/path and retains only origin plus path SHA',()=>{
 assert.deepEqual(traceURL('https://private-user:private-pass@example.org/private-path?private-token=yes#private-fragment'),{origin:'https://example.org',pathSHA256:sha('/private-path')});
 const {trace}=fixture();const r=request(origin+'/api/auth/session?private-token=yes');trace.pwEvent('request',r);trace.cdpRequest(cdpRequest('7',auth+'?private-token=yes'));trace.cdpEvent('cdp-failed',{requestId:'7',timestamp:11,canceled:true,errorText:'private-error '+auth+'?private-token=yes'});
 const output=JSON.stringify(trace.report);for(const secret of ['private-token','private-error','secret-query','secret-function','DO_NOT_KEEP','/src/entry.js','/api/auth/session'])assert.ok(!output.includes(secret),secret);
 assert.equal(trace.report.cdpRequests[0].initiator.frames[0].pathSHA256,sha('/src/entry.js'));
});
test('passive attach enables only Network metadata before preferences and the sole goto; lifecycle is ordered',async()=>{
 const {trace,page,calls}=fixture();await trace.attach(page);const wrapped=trace.wrapPage(page);
 await wrapped.addInitScript('preferences');await wrapped.goto(origin);await wrapped.waitForFunction('hook');
 assert.deepEqual(calls,['Network.enable','addInitScript','goto','waitForFunction']);assert.deepEqual(trace.report.commands,{gotoBegins:1,preferencesRegistered:true,initBeforeOnlyGoto:true});
 const kinds=trace.report.events.map(e=>e.kind);for(const kind of ['trace-installed','preferences-installed','goto-BEGIN','frame-navigation','domcontentloaded','load','goto-END'])assert.ok(kinds.includes(kind));
 assert.ok(kinds.indexOf('preferences-installed')<kinds.indexOf('goto-BEGIN'));assert.ok(kinds.indexOf('domcontentloaded')<kinds.indexOf('goto-END'));
 assert.ok(trace.report.events.every((e,i,a)=>!i||e.nodeMs>=a[i-1].nodeMs));
 assert.equal(trace.report.events.find(e=>e.kind==='frame-navigation').activeCommand.name,'goto');
});
test('preference and single navigation invariant flags violations without changing commands',async()=>{
 const {trace,page,calls}=fixture(),wrapped=trace.wrapPage(page);await wrapped.goto(origin);await wrapped.goto(origin);
 assert.equal(trace.report.commands.initBeforeOnlyGoto,false);assert.equal(trace.report.commands.gotoBegins,2);assert.deepEqual(calls,['goto','goto']);
});
test('PW/CDP auth metadata preserves IDs, timing and bounded initiator without body or header access',async()=>{
 const {trace,page,session}=fixture();await trace.attach(page);const r=request();
 page.emit('request',r);session.emit('Network.requestWillBeSent',cdpRequest());
 page.emit('response',{request:()=>r,status:()=>200,body:forbidden,text:forbidden,headers:forbidden});
 session.emit('Network.responseReceived',{requestId:'7',timestamp:10.5,response:{status:200,timing:{requestTime:9,dnsStart:1,receiveHeadersEnd:4},get headers(){return forbidden();}}});
 page.emit('requestfinished',r);session.emit('Network.loadingFinished',{requestId:'7',timestamp:12,encodedDataLength:42});
 const pw=trace.report.pwRequests[0],cdp=trace.report.cdpRequests[0];assert.deepEqual(pw.cdpCandidates,['7']);assert.match(pw.correlation,/not a proven causal link/);assert.equal(pw.timing.requestStart,5);assert.equal(pw.status,200);
 assert.equal(cdp.frameId,'frame-1');assert.equal(cdp.loaderId,'loader-1');assert.equal(cdp.responseMetadata.timing.receiveHeadersEnd,4);assert.equal(cdp.finishMetadata.encodedDataLength,42);
 assert.deepEqual(cdp.initiator.frames[0],{...traceURL(origin+'/src/entry.js'),line:10,column:20});
});
test('ambiguous same URL requests remain candidates, not asserted one-to-one causation',()=>{
 const {trace}=fixture();trace.pwEvent('request',request());trace.cdpRequest(cdpRequest('1'));trace.cdpRequest(cdpRequest('2'));
 assert.deepEqual(trace.report.pwRequests[0].cdpCandidates,['1','2']);assert.match(trace.report.pwRequests[0].correlation,/ambiguous/);
});
test('first fatal request remains strict and underlying later proof commands stay zero',async()=>{
 const policy=createProofEgress({localOrigin:origin,dependency:{},readThree:forbidden});
 const {trace,page,calls}=fixture({getFailure:()=>policy.report.firstCause});await trace.attach(page);
 page.goto=async()=>{page.emit('requestfailed',request());policy.fail('REQUEST_FAILED',auth,'net::ERR_ABORTED');};
 const wrapped=trace.wrapPage(policy.guardPage(page));await wrapped.addInitScript('preferences');
 await assert.rejects(wrapped.goto(origin),/REQUEST_FAILED/);await assert.rejects(wrapped.evaluate('NO_LATER_PROOF'),/REQUEST_FAILED/);await assert.rejects(wrapped.waitForFunction('NO_LATER_PROOF'),/REQUEST_FAILED/);
 assert.equal(calls.filter(c=>['evaluate','waitForFunction'].includes(c)).length,0);assert.equal(trace.report.firstCause.code,'REQUEST_FAILED');assert.equal(trace.report.firstCause.activeCommand.name,'goto');assert.deepEqual(trace.report.firstCause.pwCandidates,['pw-1']);
 trace.beginCleanup('fatal-finally');await wrapped.close();trace.finish('closed');assert.ok(trace.report.cleanupEvents.some(e=>e.kind==='close'));assert.equal(trace.report.firstCause.phase,'run');
});
test('event/request caps retain first failure and correlations, with separately bounded cleanup',()=>{
 let cause=null;const {trace}=fixture({maxEvents:2,maxRequests:1,maxCleanupEvents:2,getFailure:()=>cause});
 trace.pwEvent('request',request());trace.cdpRequest(cdpRequest('first'));
 for(let i=0;i<200;i++)trace.mark('repeat');
 trace.cdpRequest(cdpRequest('overflow'));trace.cdpEvent('cdp-failed',{requestId:'overflow',type:'Fetch',timestamp:22,canceled:true,errorText:'net::ERR_ABORTED',blockedReason:'inspector'});
 trace.pwEvent('request-failed',request());cause={code:'REQUEST_FAILED',...traceURL(auth)};trace.captureCause();
 trace.beginCleanup('finally');for(let i=0;i<50;i++)trace.mark('cleanup-repeat');trace.finish('closed');
 assert.equal(trace.report.events.length,2);assert.equal(trace.report.cleanupEvents.length,2);assert.equal(trace.report.pwRequests.length,1);assert.equal(trace.report.cdpRequests.length,1);assert.equal(trace.report.firstFailedPW.error,'net::ERR_ABORTED');assert.equal(trace.report.firstFailedCDP.id,'overflow');assert.equal(trace.report.firstFailedCDP.blockedReason,'inspector');
 assert.ok(trace.report.firstCause.cdpCandidates.includes('overflow'));assert.ok(trace.report.firstCause.pwCandidates.includes(trace.report.firstFailedPW.id));assert.ok(trace.report.caps.droppedEvents>=200);assert.ok(trace.report.caps.droppedCleanup>0);assert.match(trace.report.caps.terminationLabel,/capped/);assert.equal(trace.report.termination.capped,true);
});
test('cleanup cancellation is labeled independently and cannot replace a run first cause',async()=>{
 let cause={code:'HTTP_FAILURE',...traceURL(origin+'/first')};const {trace,page}=fixture({getFailure:()=>cause});await trace.attach(page);trace.captureCause();trace.beginCleanup('finally');
 cause={code:'REQUEST_FAILED',...traceURL(auth)};page.emit('requestfailed',request());trace.cdpRequest(cdpRequest());trace.cdpEvent('cdp-failed',{requestId:'7',timestamp:20,canceled:true,errorText:'net::ERR_ABORTED'});await page.close();trace.finish('owned-closed');
 assert.equal(trace.report.firstCause.code,'HTTP_FAILURE');assert.equal(trace.report.firstFailedPW.failurePhase,'cleanup');assert.equal(trace.report.firstFailedCDP.arrivalPhase,'cleanup');assert.ok(trace.report.cleanupEvents.every(e=>e.phase==='cleanup'));assert.equal(trace.report.termination.label,'owned-closed');
});
test('byte cap and pathological stack size are bounded; observer exceptions are explicit',async()=>{
 const {trace,page}=fixture({maxEventBytes:100});await trace.attach(page);const event=cdpRequest();event.initiator.stack.callFrames=Array.from({length:1000},()=>({url:origin+'/secret',lineNumber:1,columnNumber:2}));event.initiator.stack.parent=event.initiator.stack;trace.cdpRequest(event);
 assert.equal(trace.report.cdpRequests[0].initiator.frames.length,8);assert.equal(trace.report.cdpRequests[0].initiator.truncated,true);assert.ok(trace.report.caps.reached);
 for(let i=0;i<50;i++)page.emit('request',{url:forbidden});assert.equal(trace.report.observerErrors.length,4);assert.ok(!JSON.stringify(trace.report).includes('FORBIDDEN_BODY'));
});
test('parser initiator location is sanitized, and capped missing starts are explicitly unavailable',()=>{
 const {trace}=fixture({maxRequests:1});const e=cdpRequest();e.initiator={type:'parser',url:origin+'/private-parser?private-query',lineNumber:4,columnNumber:6};trace.cdpRequest(e);assert.deepEqual(trace.report.cdpRequests[0].initiator.location,{...traceURL(origin+'/private-parser'),line:4,column:6});trace.cdpRequest(cdpRequest('overflow-1'));trace.cdpRequest(cdpRequest('overflow-2'));trace.cdpEvent('cdp-failed',{requestId:'overflow-1',type:'Fetch',timestamp:4,canceled:true,errorText:'net::ERR_ABORTED'});assert.match(trace.report.firstFailedCDP.correlation,/unavailable after cap/);assert.equal(trace.report.firstFailedCDP.id,'overflow-1');assert.equal(trace.report.firstFailedCDP.arrivalPhase,'run');assert.ok(!JSON.stringify(trace.report).includes('private-parser'));
});
test('source integration keeps the frozen preference initializer/sole goto and stops diagnostic before proof/photos',async()=>{
 const source=await readFile(new URL('./terrain-material.browser.mjs',import.meta.url),'utf8');
 assert.equal((source.match(/await page\.goto\(/g)||[]).length,1);assert.equal((source.match(/await page\.addInitScript\(/g)||[]).length,1);
 assert.ok(source.indexOf('await trace.attach(rawPage)')<source.indexOf('await page.goto('));assert.ok(source.indexOf('await page.addInitScript(')<source.indexOf('await page.goto('));
 const init=source.split('\n').find(line=>line.includes('await page.addInitScript('));assert.equal(sha(init.trim()),'feb2c438cd17e69dee9224dcb238c33591a209b8b88c11c62f75dbfe3a552a68');
 assert.match(source,/if\(diagnosticOnly\)\{trace\.mark\('native-hook-observed-no-physics-or-photo'\).*await page\.close\(\);egress\.check\(\);continue;\}/);
 assert.match(source,/diagnosticOnly\?'diagnostic-completed-not-baseline':'passed'/);assert.ok(source.indexOf('if(diagnosticOnly){trace.mark(')<source.indexOf('await page.evaluate(prepareTerrainView'));
 const collector=await readFile(new URL('./material-proof-trace.mjs',import.meta.url),'utf8');assert.doesNotMatch(collector,/(?:node:(?:fs|http|https|net)|writeFile|appendFile|createWriteStream)/);assert.doesNotMatch(collector,/\.(?:body|text|json|headers|allHeaders|postData|cookies|fetch|abort|route)\s*\(/);assert.deepEqual([...collector.matchAll(/session\.send\('([^']+)'/g)].map(m=>m[1]),['Network.enable']);
 const entry=await readFile(new URL('./material-proof-diagnostic.mjs',import.meta.url),'utf8');assert.match(entry,/TERRAIN_DIAGNOSTIC_ONLY='1'/);
});
