// Harness evidence only. Never sends a packet, invokes recovery, or changes input.
export function appendBounded(records, record) {
  records.push(record);
  if (records.length > 32) records.splice(16, 1); // first16 and latest16
}
const pose = value => value && Object.fromEntries(['x','y','z','yaw','s','u','vLong','vLat','motionEpoch','sampleTime'].map(key => [key,value[key]]));
export function createRecoveryWireLog() {
  const records = [], latestPoses = {};
  return { records, latestPoses,
    observe(client, direction, packet) {
      if (direction === 'sent' && packet.type === 'state') latestPoses[client] = { at: Date.now(), state: pose(packet.state || packet) };
      if (direction === 'received' && packet.type === 'snapshot') latestPoses[client + 'Accepted'] = { at: Date.now(), players: (packet.players || []).slice(0,8).map(player => ({id:player.id,state:pose(player.state)})) };
      if (['recover','recovered','recover-denied'].includes(packet.type)) appendBounded(records, {client,direction,at:Date.now(),type:packet.type,data:JSON.stringify(packet).slice(0,4096)});
    }
  };
}

// Self-contained because Playwright serializes this function into the renderer.
export function installRecoveryObserver() {
  const multiplayer = window.__multiplayer;
  if (!multiplayer || window.__desktopRecoveryDiagnostic) return;
  const diagnostic = window.__desktopRecoveryDiagnostic = { events: [], frames: 0 };
  const record = event => { diagnostic.events.push({at:performance.now(),...event}); if(diagnostic.events.length>32)diagnostic.events.splice(16,1); };
  const recover = multiplayer.recover;
  multiplayer.recover = function (...args) {
    record({type:'recover-called',options:args[0],towing:window.__game?.towing,motionEpoch:this.stateSender?.motionEpoch});
    try {
      const promise = recover.apply(this,args);
      Promise.resolve(promise).then(result => record({type:'recover-resolved',result}),error => record({type:'recover-rejected',message:error.message,stack:error.stack}));
      return promise;
    } catch(error) { record({type:'recover-threw',message:error.message,stack:error.stack}); throw error; }
  };
  for (const type of ['keydown','keyup']) addEventListener(type,event => {
    if(event.code==='KeyR')record({type,code:event.code,key:event.key,repeat:event.repeat,trusted:event.isTrusted,target:event.target?.tagName,targetId:event.target?.id,focused:document.hasFocus(),hidden:document.hidden,activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id});
  },true);
  const frame=()=>{diagnostic.frames++;requestAnimationFrame(frame);};requestAnimationFrame(frame);
}

export function readRecoveryDiagnostic(label) {
  const multiplayer=window.__multiplayer,game=window.__game;
  return {label,at:performance.now(),focused:document.hasFocus(),hidden:document.hidden,activeTag:document.activeElement?.tagName,activeId:document.activeElement?.id,
    game:{state:game?.state,towing:game?.towing},menu:{open:window.__flow?.menu?.open,screen:window.__flow?.menu?.screen,inMenu:window.__flow?.inMenu?.(),panelHidden:multiplayer?.panel?.hidden},
    connected:multiplayer?.connected,retired:multiplayer?.retired,motionEpoch:multiplayer?.stateSender?.motionEpoch,
    pending:multiplayer?.recoveryPending ? {raceId:multiplayer.recoveryPending.raceId,motionEpoch:multiplayer.recoveryPending.motionEpoch,retried:multiplayer.recoveryPending.retried} : null,
    manualRecovered:window.__desktopRecovered,diagnostic:window.__desktopRecoveryDiagnostic};
}
