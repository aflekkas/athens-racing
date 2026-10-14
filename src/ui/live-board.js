export function connectionQuality(latency) {
  const ms=Math.max(0,Math.round(Number(latency)||0));
  return {band:ms>300?'poor':ms>150?'fair':'good',label:ms>300?ms+' ms':''};
}
export const metres=value=>Number.isFinite(value)?Math.round(Math.abs(value))+' m':'—';

export function renderLiveBoard(mp,state) {
  const board=mp.board,l=mp.lobby,watching=mp.spectating(),quality=connectionQuality(mp.latency);
  board.replaceChildren();
  const head=document.createElement('header'),title=document.createElement('b'),dot=document.createElement('span');
  title.textContent=l.status==='results'?'RESULTS':watching?'SPECTATING':mp.retired?'RETIRED':mp.me?.finish!=null?'FINISHED':'LIVE';
  dot.className='mp-latency';dot.dataset.quality=quality.band;dot.textContent=quality.label;dot.setAttribute('aria-label','Connection '+quality.band+(quality.label?' · '+quality.label:''));head.append(title,dot);board.append(head);
  if(watching){
    const controls=document.createElement('div');controls.className='mp-watch';
    const prev=document.createElement('button'),next=document.createElement('button'),select=document.createElement('select');
    prev.textContent='‹';prev.setAttribute('aria-label','Watch previous driver');prev.onclick=()=>{mp.stepSpectator(-1);prev.blur();mp.boardAt=0;};
    next.textContent='›';next.setAttribute('aria-label','Watch next driver');next.onclick=()=>{mp.stepSpectator(1);next.blur();mp.boardAt=0;};
    select.setAttribute('aria-label','Choose driver to watch');
    for(const p of mp.spectatorDrivers()){const o=document.createElement('option');o.value=p.id;o.textContent=p.name;select.append(o);}
    select.value=watching.id;select.onchange=()=>{mp.selectSpectator(select.value);select.blur();mp.boardAt=0;};controls.append(prev,select,next);board.append(controls);
  }
  const telemetry=mp.telemetry(state);
  if(telemetry&&l.status!=='results'){const gaps=document.createElement('div');gaps.className='mp-gaps';gaps.textContent='↑ '+metres(telemetry.aheadMetres)+'   ↓ '+metres(telemetry.behindMetres);gaps.setAttribute('aria-label','Ahead '+metres(telemetry.aheadMetres)+', behind '+metres(telemetry.behindMetres));board.append(gaps);}
  const list=document.createElement('ol');
  mp.ranking(state.s).forEach((p,i)=>{
    const row=document.createElement('li');row.className=p.id===(watching?.id||mp.id)?'me':'';
    if(l.status==='results'){row.textContent=mp.objectiveMode?mp.resultRowText(p,i):`${p.dnf?'DNF':i+1}. ${p.name} · ${p.finish!=null?p.finish.toFixed(2)+' s':'DNF'}`;}
    else {const position=document.createElement('span'),name=document.createElement('span');position.className='mp-position';position.textContent=p.dnf?'DNF':String(i+1);name.className='mp-driver-name';name.textContent=p.name;name.title=p.name;row.append(position,name);}
    list.append(row);
  });board.append(list);
}
