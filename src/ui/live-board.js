import { morph, esc } from './components.js';
export function connectionQuality(latency) {
  const ms=Math.max(0,Math.round(Number(latency)||0));
  return {band:ms>300?'poor':ms>150?'fair':'good',label:ms>300?ms+' ms':''};
}
export const metres=value=>Number.isFinite(value)?Math.round(Math.abs(value))+' m':'—';

// The in-race standings are patched in place (components.js morph) four times a second: only rows whose text changed are
// touched, so the board never rebuilds under the pointer and an open spectator dropdown keeps its value.
export function renderLiveBoard(mp,state) {
  const board=mp.board,l=mp.lobby,watching=mp.spectating(),quality=connectionQuality(mp.latency);
  if(!board.__live){board.__live=true;
    board.addEventListener('click',e=>{const b=e.target.closest?.('[data-watch]');if(!b)return;mp.stepSpectator(Number(b.dataset.watch));b.blur();mp.boardAt=0;});
    board.addEventListener('change',e=>{if(!e.target.matches?.('ui-select'))return;mp.selectSpectator(e.target.value);e.target.blur();mp.boardAt=0;});}
  const title=l.status==='results'?'RESULTS':watching?'SPECTATING':mp.retired?'RETIRED':mp.me?.finish!=null?'FINISHED':'LIVE';
  let html=`<header><b>${title}</b><span class="mp-latency" data-quality="${quality.band}" aria-label="Connection ${quality.band}${quality.label?' · '+esc(quality.label):''}">${esc(quality.label)}</span></header>`;
  if(watching)html+=`<div class="mp-watch"><button data-watch="-1" aria-label="Watch previous driver">‹</button><ui-select aria-label="Choose driver to watch">${mp.spectatorDrivers().map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</ui-select><button data-watch="1" aria-label="Watch next driver">›</button></div>`;
  const telemetry=mp.telemetry(state);
  if(telemetry&&l.status!=='results')html+=`<div class="mp-gaps" aria-label="Ahead ${metres(telemetry.aheadMetres)}, behind ${metres(telemetry.behindMetres)}">↑ ${metres(telemetry.aheadMetres)}   ↓ ${metres(telemetry.behindMetres)}</div>`;
  html+=`<ol>${mp.ranking(state.s).map((p,i)=>{
    const cls=p.id===(watching?.id||mp.id)?'me':'';
    if(l.status==='results')return `<li class="${cls}">${esc(mp.objectiveMode?mp.resultRowText(p,i):`${p.dnf?'DNF':i+1}. ${p.name} · ${p.finish!=null?p.finish.toFixed(2)+' s':'DNF'}`)}</li>`;
    return `<li class="${cls}"><span class="mp-position">${p.dnf?'DNF':i+1}</span><span class="mp-driver-name" title="${esc(p.name)}">${esc(p.name)}</span></li>`;
  }).join('')}</ol>`;
  morph(board,html);
  const select=board.querySelector('ui-select');if(select&&watching&&document.activeElement!==select&&select.value!==watching.id)select.value=watching.id;
}
