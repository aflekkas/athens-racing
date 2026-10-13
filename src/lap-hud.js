// A single compact timing widget. No points, medals or standings UI in the lap display.
let element;
const format=t=>`${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,'0')}`;
export function updateLapHud(run,visible=true) {
  if(!element){element=document.createElement('div');element.id='lapTiming';element.hidden=true;element.innerHTML='<b></b><span></span><small></small>';document.body.append(element);const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./map-select.css',import.meta.url).href;document.head.append(css);}
  element.hidden=!visible||!run?.r.closed;
  if(element.hidden)return;
  element.children[0].textContent=`LAP ${run.lap}/${run.r.laps}`;
  element.children[1].textContent=format(run.done&&run.lapTimes.length?run.lapTimes.at(-1):run.lapTime);
  element.children[2].textContent=run.lapTimes.length?`LAST ${format(run.lapTimes.at(-1))} · BEST ${format(Math.min(...run.lapTimes))}`:'';
}
