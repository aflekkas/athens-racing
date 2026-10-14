import { ui, esc } from './components.js';

// Presentation only: membership and forced starts remain server-authoritative.
export function syncHostControls() {
  const mp=window.__multiplayer,room=document.getElementById('mp-room'),l=mp?.lobby;
  if(!room||!l)return;
  const host=l.host===mp.id,waiting=l.status==='waiting';
  let force=room.querySelector('[data-force-start]');
  if(!force){const actions=room.querySelector('.mp-actions');if(actions){force=document.createElement('button');force.dataset.forceStart='';force.textContent='FORCE START';force.onclick=async()=>{const choice=await ui.prompt({title:'START WITHOUT EVERYONE READY?',body:'Connected drivers will join this round. Drivers still loading can join when their track is ready.',actions:[{id:'force',label:'FORCE START',variant:'primary'},{id:'cancel',label:'KEEP WAITING'}]});if(choice==='force')mp.startRace({force:true});};actions.querySelector('#mp-start')?.after(force);}}
  if(force){const hidden=!host||!waiting,disabled=!mp.worldReady||l.players.filter(p=>p.connected!==false).length<2;if(force.hidden!==hidden)force.hidden=hidden;if(force.disabled!==disabled)force.disabled=disabled;}
  for(const row of room.querySelectorAll('#mp-members [data-player-id]')){
    const id=row.dataset.playerId;let kick=row.querySelector('[data-kick-player]');
    if(host&&id!==mp.id&&!kick){kick=document.createElement('button');kick.dataset.kickPlayer=id;kick.textContent='KICK';kick.setAttribute('aria-label','Kick '+(l.players.find(p=>p.id===id)?.name||'driver'));kick.onclick=async()=>{const name=l.players.find(p=>p.id===id)?.name||'this driver';if(await ui.prompt({title:'KICK '+name+'?',body:'They will be removed from the lobby and can rejoin immediately.',actions:[{id:'kick',label:'KICK DRIVER',variant:'primary'},{id:'cancel',label:'CANCEL'}]})==='kick')mp.kickPlayer(id);};row.append(kick);}
    if(kick&&kick.hidden===host)kick.hidden=!host;
    let block=row.querySelector('[data-block-player]');
    if(host&&id!==mp.id&&!block){block=document.createElement('button');block.dataset.blockPlayer=id;block.textContent='BLOCK';block.onclick=async()=>{const name=l.players.find(p=>p.id===id)?.name||'this driver';if(await ui.prompt({title:'BLOCK '+name+'?',body:'Remove this driver and prevent them from rejoining this lobby until you unblock them or the lobby expires.',actions:[{id:'block',label:'BLOCK DRIVER',variant:'primary'},{id:'cancel',label:'CANCEL'}]})==='block')mp.blockPlayer(id);};row.append(block);}
    if(block&&block.hidden===host)block.hidden=!host;
  }
  let blocked=room.querySelector('[data-blocked-players]');const players=host?l.blockedPlayers||[]:[],key=JSON.stringify(players);
  if(!blocked&&players.length){blocked=document.createElement('details');blocked.dataset.blockedPlayers='';blocked.className='mp-settings-advanced';room.querySelector('#mp-members')?.after(blocked);blocked.addEventListener('click',e=>{const id=e.target.closest('[data-unblock-player]')?.dataset.unblockPlayer;if(id)mp.unblockPlayer(id);});}
  if(blocked&&blocked.dataset.value!==key){blocked.dataset.value=key;blocked.hidden=!players.length;blocked.innerHTML='<summary>BLOCKED DRIVERS</summary>'+players.map(p=>'<div class="mp-blocked-row"><span>'+esc(p.name)+'</span><button data-unblock-player="'+esc(p.id)+'">UNBLOCK</button></div>').join('');}
}
