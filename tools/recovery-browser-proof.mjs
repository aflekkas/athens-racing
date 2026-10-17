// Generate a lightweight, explicitly labelled replay of the actual HUD + board.
// First run server/race-progress-trace.test.mjs. No world/physics result is fabricated.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const trace = JSON.parse(readFileSync(new URL('.scratch/recovery-progress/three-client--1.json', root)));
let html = readFileSync(new URL('index.html', root), 'utf8');
html = html.replace('<body>', '<body class="loaded racing">').replace('<head>', '<head><base href="/">').replace('<script type="module" src="./src/main.js"></script>', '');
const script = `
import { Hud } from '/src/hud.js';
import { Multiplayer } from '/src/multiplayer.js';
import { renderLiveBoard } from '/src/ui/live-board.js';
const trace = ${JSON.stringify(trace)};
const data = await (await fetch('/data/maps/psychiko/map.json')).json();
const r=data.route;
const route={...r,N:r.x.length,X:r.x,Z:r.z,names:[],zone:()=>({name:'PSYCHIKO'}),point:()=>({x:0,y:0,z:0})};
const hud=new Hud({id:'psychiko',route,data:{buildings:[],sideRoads:[],coast:[],marks:[]},terrain:{GX:2,GZ:2,H:[0,0,0,0],C:[0,0,0,0],T:1,minX:0,minZ:0}});
hud.setRange(trace.event.s0,trace.event.s1);
const mp=Object.create(Multiplayer.prototype);
Object.assign(mp,{id:'Alice',latency:40,peers:new Map(),board:document.querySelector('#mp-board'),offset:0});
mp.now=()=>20000;
window.proofStep=index=>{
 const item=trace.trace[index], players=item.rows.map(row=>({id:row.name,name:row.name,finish:row.finish,dnf:false,connected:true}));
 mp.lobby={status:'race',raceId:'proof',startAt:0,event:trace.event,players,standings:item.rows.map(row=>({...row,id:row.name}))};
 const mine=item.rows.find(row=>row.name==='Alice'), state={s:trace.event.s0+trace.event.dir*mine.progress,vLong:0,rpm:900,gear:1};
 const telemetry=mp.telemetry(state);
 hud.frame=0;
 const st={pos:telemetry.pos,time:telemetry.time,gap:telemetry.gap,gapUnit:telemetry.gapUnit,s:state.s,rs:state.s,pen:0,kmh:0,unit:'KM/H',limit:null};
 hud.update(st);
 if(st.gapUnit)document.querySelector('#gap').textContent=!Number.isFinite(st.gap)?'—':(st.gap>=0?'+':'−')+Math.abs(st.gap).toFixed(st.gapUnit==='m'?0:2)+' '+st.gapUnit;
 document.querySelector('#rivalName').textContent=telemetry.comparison?.name||'';
 renderLiveBoard(mp,state);
 document.querySelector('#proof-label').textContent=item.label;
 document.querySelector('#proof-progress').textContent=item.rows.map(row=>row.name+' '+row.progress.toFixed(1)+' m').join(' · ');
 return {label:item.label,position:document.querySelector('#posN').textContent,gap:document.querySelector('#gap').textContent,board:mp.board.innerText,telemetry};
};
document.querySelector('#posBox .of').textContent='/3';
window.proofReady=true;window.proofStep(0);
`;
html = html.replace('</body>', `<section id="proof-note"><b>RECOVERY / STANDINGS REGRESSION REPLAY</b><h1 id="proof-label"></h1><p id="proof-progress"></p><p>Production HUD and multiplayer board · three-client server trace on real Psychiko geometry.<br>Deterministic pose replay, not a rendered driving run. World loading is excluded from this fixture.</p><p>Psychiko default: reverse · toggle: original direction · ordinary tow: 250 ms online placement hold, no added solo penalty.</p></section><aside id="mp-board"></aside><script type="module">${script}</script></body>`);
html = html.replace('</head>', '<link rel="stylesheet" href="/src/multiplayer.css"><style>body{background:#101722!important}#c,#ui,#menu,#fade,#err,#mapBox,#tacho,.credits{display:none!important}#hud{z-index:10002;opacity:1!important;visibility:visible!important}#proof-note{z-index:10000;position:absolute;left:15%;top:30%;width:65%;font:18px system-ui;color:#eee}#proof-note p{color:#abb9c9;line-height:1.6}#mp-board{z-index:10001;display:block;opacity:1;right:35px;top:35px;min-width:240px}#proof-note h1{font-size:32px}</style></head>');
writeFileSync(new URL('assets/dev-recovery-proof.html', root), html);
console.log('Generated assets/dev-recovery-proof.html; serve locally, capture, then remove before committing.');
