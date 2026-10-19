// Screenshot-only helpers. Keep the actual notice modules, HUD and renderer; freeze their clocks while painting.
const fs = require('node:fs/promises');
const {resolve} = require('node:path');
async function prepareCapture(page) {
  await page.evaluate(async()=>{
    const n=window.__notifications;if(n)clearInterval(n.timer);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    if(window.__sim?.render){
      window.dispatchEvent(new Event('resize'));
      __sim.cameraBlend.active=false;__sim.step(8,1e-6);__sim.cameraBlend.active=false;
      __sim.render();
    }
    if(n){n.dirty=true;n.update();}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  });
}
async function capturePlacements(page,context,{out,baseline,variant,prepare=true}) {
  await page.evaluate(async variant=>{
    if(variant==='after'){window.auditEngine=(await import('/src/engine-hud.js')).updateEngineHud;window.auditComponents=await import('/src/ui/components.js');}
    if(variant==='before'){
      const n=__notifications;clearInterval(n.timer);n.clear();n.root?.remove();
      document.querySelector('link[href$="/src/ui/notifications.css"]')?.remove();
      window.__notifications=(await import('/legacy/src/ui/notifications.js')).notifications;
      window.auditEngine=(await import('/legacy/src/engine-hud.js')).updateEngineHud;
      window.auditComponents=await import('/legacy/src/ui/components.js');
      __notifications.mount();clearInterval(__notifications.timer);
    }
  },variant);
  const checks=[];await fs.mkdir(resolve(out,variant),{recursive:true});
  for(const[width,height]of[[1280,800],[1920,1080]]){
    await page.setViewportSize({width,height});await page.mouse.move(width/2,height/2);
    for(const view of ['chase','cockpit']){
      console.log('RESHOOT',variant,width,view);
      await page.evaluate(([view,variant])=>{
        if(__sim.G.cam!==view)__flow.action('camera');__sim.cameraBlend.active=false;
        document.body.dataset.cameraView=view;Object.assign(__sim.look,{yaw:0,pitch:0,targetYaw:0,targetPitch:0,yawV:0,pitchV:0,zoom:1,idleT:9,back:0,backV:0});__sim.step(2);__sim.cameraBlend.active=false;const n=__notifications;n.clear();
        auditEngine({engHealth:0,coolantTemp:90,engineStalled:true},{visible:true,repairAvailable:true,towLabel:'R / T',towCost:0,onRepair:()=>{}});
        const tow=document.createElement('aside');tow.id='tow-prompt';tow.className='tow-prompt ui-prompt minimised';tow.innerHTML=variant==='before'?'<button class="tow-chip">R: TOW</button>':'<button class="tow-chip">'+auditComponents.kbd('R')+' Tow and repair</button>';n.adopt('tow',tow,{priority:60,persistent:true});n.dirty=true;n.update();
      },[view,variant]);
      if(prepare)await prepareCapture(page);
      await page.waitForTimeout(350);
      const cdp=await context.newCDPSession(page),shot=await cdp.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(resolve(out,variant,`placement-${view}-${width}.png`),Buffer.from(shot.data,'base64'));await cdp.detach();
      const result=await page.evaluate(async([width,height,view,variant])=>{
        const cards=[...document.querySelectorAll('#notification-lane .race-notice:not([hidden])')],r=document.querySelector('#notification-lane').getBoundingClientRect();
        const visible=el=>el.getClientRects().length&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';
        const selectors=['#accounts-offline','.wheel-hud','#posBox','#mapBox','#dialBox','#limitSign','#evBox.on .objective-card','#mp-board','#race-settings','#mp-toggle','#sigBox','#driving-feedback','#touch-controls button','#touch-controls .touch-steer'];
        const obstacles=[...document.querySelectorAll(selectors.join(','))].filter(visible).map(el=>({id:el.id||el.className,r:el.getBoundingClientRect()}));
        const w=Math.min(width*.3,height*.75),top=height*.012;obstacles.push({id:'mirror',r:view==='cockpit'?{left:width*.2,right:width*.8,top:0,bottom:height*.33}:{left:(width-w)/2,right:(width+w)/2,top,bottom:top+w/4.6}});
        if(variant==='after'&&view==='cockpit'){const {projectedMirrorBounds}=await import('/src/ui/notification-queue.js');obstacles.push(...projectedMirrorBounds(__sim.player.cockpit.mirrors,__sim.camera,width,height).map(r=>({id:'actual-mirror',r})));}
        const overlaps=cards.flatMap(el=>{const b=el.getBoundingClientRect();return obstacles.filter(o=>b.left<o.r.right&&b.right>o.r.left&&b.top<o.r.bottom&&b.bottom>o.r.top).map(o=>o.id);});
        return{width,height,view,variant,visible:cards.map(el=>el.dataset.notificationId),rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},text:document.querySelector('#notification-lane').textContent,overlaps,outside:cards.some(el=>{const b=el.getBoundingClientRect();return b.left<0||b.top<0||b.right>width||b.bottom>height;})};
      },[width,height,view,variant]);
      checks.push(result);
      if(variant==='after'&&(result.visible.length!==1||result.overlaps.length||result.outside))throw new Error('Unsafe notice: '+JSON.stringify(result));
    }
  }
  await fs.writeFile(resolve(out,variant+'-placements.json'),JSON.stringify({baseline,checks},null,2));return checks;
}
module.exports={prepareCapture,capturePlacements};
async function regenerateBaseline(page,context,{out,baseline,prepare=true,variant='before'}) {
  const errors=[],onError=e=>errors.push(e.stack);page.on('pageerror',onError);
  try{
    console.log('BASELINE: repaint legacy notices on the current scene and HUD');
    const origin=new URL(page.url()).origin;
    await page.goto(origin+'/?simhook&map=megara&event=free&quality=low&notraffic&nopedestrians&cam=chase',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__sim?.player&&document.body.classList.contains('loaded'));
    await page.evaluate(async()=>{
      await document.fonts.ready;__flow.menu.hide();document.querySelector('#accounts-offline')?.remove();__multiplayer.panel.hidden=true;__sim.G.state='race';__sim.G.cameraStarting=false;document.body.classList.remove('menu','menu-backdrop','ui-open','counting');document.body.classList.add('racing');document.querySelector('#count').textContent='';
    });
    const checks=await capturePlacements(page,context,{out,baseline,variant,prepare});
    await fs.writeFile(resolve(out,variant==='before'?'before-validation.json':'after-projection-validation.json'),JSON.stringify({errors,checks,actions:null,baseline,scene:variant==='before'?'Current renderer and HUD; legacy notification modules from the baseline':'Current renderer with projected physical mirror bounds'},null,2));
    if(errors.length)throw new Error('Baseline browser errors: '+errors.join('\n'));
    console.log('BASELINE COMPLETE');
  }finally{page.off('pageerror',onError);}
}
module.exports.regenerateBaseline=regenerateBaseline;
