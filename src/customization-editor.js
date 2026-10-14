import {account,renderAccountCard,bindAccountCard} from './account.js';
import {esc} from './ui/components.js';
import {listDecals} from './vehicle-decals.js';
import {PAINTS} from './vehicle-paint.js';
import {normalizeAppearance,referencedAssets} from './customization-data.js';
import {getCustomizationRepository,currentCarAppearance,applyCustomization} from './customization-store.js';
import {decodeUserPhoto,renderPhotoSticker,savePhotoSticker,preparePhotoUrl,deletePhotoSticker,listLocalPhotos,resolvePhotoSticker,isPublicPhotoSticker} from './photo-stickers.js';
import {mountCustomizationPreview} from './customization-preview.js';
import {CHARACTER_PRESETS,characterPresetLook} from './character-presets.js';
import {DRIVER_HAIR_STYLES,DRIVER_BUILDS} from './driver-appearance-data.js';
const styleUrl=new URL('./customization-editor.css',import.meta.url).href;
const option=(value,label)=>`<option value="${esc(value)}">${esc(label)}</option>`;
const designOptions=()=>{const groups=new Map();for(const d of listDecals()){const category=d.category||'Racing';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(d);}return [...groups].map(([category,designs])=>`<optgroup label="${esc(category)}">${designs.map(d=>option(d.id,d.name)).join('')}</optgroup>`).join('');};
const range=(key,label,min,max,step)=>`<label>${label}<input data-layer-field="${key}" type="range" min="${min}" max="${max}" step="${step}"><output data-output="${key}"></output></label>`;
let opened;
export async function openCustomizationEditor({spec,onChange}={}){
  if(!spec?.id)throw new Error('Choose a car first.');if(opened){opened.close();if(opened)return opened;}
  if(!document.querySelector('link[data-customization-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href=styleUrl;link.dataset.customizationStyle='';document.head.append(link);}
  const previousFocus=document.activeElement,root=document.createElement('section');root.className='customizer';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Customize '+spec.name);
  let draft=currentCarAppearance(spec),selectedId='',layerIndex=-1,repository,signedIn=false,preview,closed=false,busy=false,sourceImage,photoPreview,photoToken=0,photoMode='fit',assets=[];
  const createdAssets=new Set();
  root.innerHTML=`<header><div><p>GARAGE · ${esc(spec.name||spec.id)}</p><h2>YOUR CAR. YOUR DRIVER.</h2></div><button data-act="close">CLOSE</button></header>
    <div class="customizer-layout"><div class="customizer-preview" data-preview><div class="customizer-view"><button data-act="view-car">CAR</button><button data-act="view-driver">DRIVER</button><select data-preview-angle aria-label="Preview camera"><option value="front">FRONT</option><option value="side">DOORS</option><option value="roof">ROOF</option><option value="rear">REAR</option></select></div></div>
    <div class="customizer-controls"><h3>SAVED PRESETS</h3><p data-storage></p><div class="customizer-row"><select data-presets aria-label="Saved presets"></select><button data-act="new">NEW</button><button data-act="reload">RELOAD</button></div>
    <div class="customizer-row"><input data-name type="text" maxlength="40" placeholder="Name this preset" aria-label="Preset name"><button data-act="save" class="primary">SAVE & APPLY</button></div>
    <div class="customizer-row"><button data-act="rename">RENAME</button><button data-act="duplicate">DUPLICATE</button><button data-act="delete" class="danger">DELETE PRESET</button></div>
    <details open><summary>PAINT & STICKER LAYERS</summary><label>PAINT<input data-paint type="color" value="${draft.paint}"></label><div class="customizer-row"><select data-factory aria-label="Factory paint"><option value="">FACTORY PAINTS</option>${(PAINTS[spec.id]||[]).map(([name,value])=>option(value,name)).join('')}</select></div>
    <div class="customizer-row"><select data-design aria-label="Sticker design">${designOptions()}</select><button data-act="add">ADD STICKER</button><button data-act="photo">ADD YOUR PHOTO</button></div>
    <input data-photo-file type="file" accept="image/png,image/jpeg,image/webp" hidden>
    <div class="customizer-photo" data-photo-crop hidden><h3>FRAME YOUR PHOTO</h3><p>Use a photo you supply, including a face. Only the finished sticker is kept.</p><div class="customizer-row"><select data-photo-mode aria-label="Photo framing"><option value="fit">FIT WHOLE PHOTO</option><option value="crop">SQUARE CROP</option></select></div><div data-photo-canvas></div>
    <label>FRAME X<input data-crop="x" type="range" min="-1" max="1" step=".01" value="0"></label><label>FRAME Y<input data-crop="y" type="range" min="-1" max="1" step=".01" value="0"></label><label>ZOOM<input data-crop="zoom" type="range" min="1" max="3" step=".05" value="1"></label><div class="customizer-row"><button data-act="photo-use" class="primary">USE PHOTO</button><button data-act="photo-cancel">CANCEL</button></div></div>
    <p data-layer-count></p><div class="customizer-layers" data-layers></div><div data-layer-controls hidden>
      <label>SURFACE<select data-layer-field="position">${['bonnet','doors','roof','rear'].map(v=>option(v,v.toUpperCase())).join('')}</select></label>
      <label data-design-control>DESIGN<select data-layer-field="id">${designOptions()}</select></label>
      <label data-color-control>STICKER COLOR<input data-layer-field="color" type="color"></label>
      <label data-number-control>RACE NUMBER<input data-layer-field="number" type="number" min="0" max="999"></label>
      ${range('x','POSITION X',-1,1,.01)}${range('y','POSITION Y',-1,1,.01)}${range('scale','SIZE',.2,2,.05)}${range('rotation','ROTATE',-180,180,1)}
      <label>FLIP HORIZONTALLY<input data-layer-field="flipX" type="checkbox"></label><div class="customizer-row"><button data-act="layer-up">MOVE UP</button><button data-act="layer-down">MOVE DOWN</button><button data-act="layer-remove" class="danger">REMOVE LAYER</button></div>
    </div></details>
    <details open><summary>DRIVER APPEARANCE</summary><label>PRESETS<select data-character-preset aria-label="Character preset">${option('','CUSTOM LOOK')}${CHARACTER_PRESETS.map(p=>option(p.id,p.name)).join('')}</select></label><p data-character-note></p><label>HEIGHT (CM)<input data-driver="heightCm" type="number" min="140" max="210" value="175"></label><label>BUILD<select data-driver="build">${DRIVER_BUILDS.map(v=>option(v,v.toUpperCase())).join('')}</select></label>${[['skin','SKIN'],['shirt','SHIRT'],['hair','HAIR']].map(([k,n])=>`<label>${n}<input data-driver="${k}" type="color" value="${draft.driver[k]}"></label>`).join('')}<label>HAIRSTYLE<select data-driver="hairStyle">${DRIVER_HAIR_STYLES.map(v=>option(v,v.toUpperCase())).join('')}</select></label><label>HAIR VOLUME<input data-driver="hairVolume" type="range" min=".5" max="1.8" step=".05" value="1"></label><label>ACCESSORY<select data-driver="accessory">${option('none','NONE')}${option('sprayCan','SPRAY CAN')}</select></label><label>HELMET<input data-driver="helmet" type="checkbox"></label></details>
    <details><summary>YOUR PHOTO LIBRARY</summary><p>Saved photos are visible to other racers when used on your car. Remove them from presets before deleting.</p><div data-asset-list></div></details>
    <div class="customizer-account" data-account-host>${renderAccountCard()}</div></div></div>
    <footer><span data-status class="customizer-status" role="status" aria-live="polite"></span><span>8 layers · 16 presets per car · Photos resized to 512 px</span></footer>`;
  document.body.append(root);document.body.dataset.customizer='open';root.querySelector('[data-act=close]').focus();
  const q=s=>root.querySelector(s),say=(text,error=false)=>{q('[data-status]').textContent=text;q('[data-status]').dataset.error=String(error);};
  const safely=async fn=>{if(busy||closed)return;busy=true;root.setAttribute('aria-busy','true');try{await fn();}catch(e){say(e.message||String(e),true);}finally{busy=false;root.removeAttribute('aria-busy');}};
  const refresh=()=>{if(closed)return;q('[data-paint]').value=draft.paint;for(const input of root.querySelectorAll('[data-driver]')){if(input.type==='checkbox')input.checked=draft.driver[input.dataset.driver];else input.value=draft.driver[input.dataset.driver]??({heightCm:175,build:'average',hairVolume:1,accessory:'none'}[input.dataset.driver]??'');}
    q('[data-character-preset]').value=draft.driver.presetId||'';const character=CHARACTER_PRESETS.find(p=>p.id===draft.driver.presetId);q('[data-character-note]').textContent=character?.appearanceTODO?'Jonia Peroti rides in the passenger seat. Appearance details pending.':character?.id==='alex_adelman'?'One-handed steering with a spray can in the free hand.':'';
    const layers=draft.decals;q('[data-layer-count]').textContent=`${layers.length} / 8 STICKER LAYERS`;
    q('[data-layers]').innerHTML=layers.map((d,i)=>`<button data-layer="${i}" aria-pressed="${layerIndex===i}"><span>${i+1}. ${esc(d.id==='photo'?'Your photo':listDecals().find(v=>v.id===d.id)?.name||d.id)} · ${esc(d.position)}</span></button>`).join('');
    const d=layers[layerIndex];q('[data-layer-controls]').hidden=!d;if(d){for(const input of root.querySelectorAll('[data-layer-field]')){const k=input.dataset.layerField;if(input.type==='checkbox')input.checked=!!d[k];else input.value=d[k]??({x:0,y:0,scale:1,rotation:0,number:7}[k]??'');}
      q('[data-design-control]').hidden=d.id==='photo';q('[data-color-control]').hidden=d.id==='photo';q('[data-number-control]').hidden=d.id!=='roundel';for(const out of root.querySelectorAll('[data-output]'))out.value=String(d[out.dataset.output]??({scale:1}[out.dataset.output]||0));}
    q('[data-act=add]').disabled=layers.length>=8;q('[data-act=photo]').disabled=layers.length>=8;preview?.update(draft).catch(e=>say('Preview could not render: '+e.message,true));};
  const refreshPresets=()=>{const list=repository?.forCar(spec.id)||[];q('[data-presets]').innerHTML=option('','UNSAVED LOOK')+list.map(p=>option(p.id,p.name)).join('');q('[data-presets]').value=selectedId;
    for(const act of ['rename','duplicate','delete'])q(`[data-act=${act}]`).disabled=!selectedId;q('[data-storage]').textContent=signedIn?'Saved to your signed-in account. Appearance is shared with other racers.':'Guest presets and photos are saved in this browser. Sign in to sync across devices.';};
  const refreshAssets=async()=>{if(signedIn){const r=await fetch('/api/customization');if(!r.ok)return;assets=(await r.json()).assets||[];}else assets=await listLocalPhotos().catch(()=>[]);
    if(closed)return;const used=referencedAssets(repository?.snapshot()||{presets:[]});q('[data-asset-list]').innerHTML=assets.map(a=>`<div class="customizer-row"><span>${a.width} × ${a.height} · ${Math.ceil(a.size/1024)} KiB</span><button data-asset-use="${a.id}">ADD</button><button data-asset-delete="${a.id}" ${used.has(a.id)?'disabled':''}>DELETE PHOTO</button></div>`).join('')||'<p>No photos yet.</p>';};
  const load=async()=>{const state=await getCustomizationRepository();repository=state.repository;signedIn=state.signedIn;await repository.reload();const p=repository.selected(spec.id);selectedId=p?.id||'';draft=p?normalizeAppearance(p):currentCarAppearance(spec);q('[data-name]').value=p?.name||'';layerIndex=-1;refreshPresets();refresh();await refreshAssets();say('Presets loaded.');};
  const updatePhoto=async()=>{if(!sourceImage)return;const token=++photoToken,result=await renderPhotoSticker(sourceImage,{mode:photoMode,...Object.fromEntries([...root.querySelectorAll('[data-crop]')].map(e=>[e.dataset.crop,Number(e.value)]))});if(closed||token!==photoToken)return;photoPreview=result;q('[data-photo-canvas]').replaceChildren(result.canvas);};
  const cancelPhoto=()=>{photoToken++;sourceImage?.close();sourceImage=null;photoPreview=null;q('[data-photo-crop]').hidden=true;q('[data-photo-file]').value='';};
  const close=()=>{if(closed)return;if(busy){say('Please wait for the current save or upload.');return;}closed=true;cancelPhoto();preview?.dispose();unsubscribe();document.removeEventListener('keydown',keys,true);root.remove();delete document.body.dataset.customizer;opened=null;previousFocus?.focus?.();const used=referencedAssets(repository?.snapshot()||{presets:[]});for(const id of createdAssets)if(!used.has(id))deletePhotoSticker(id,{signedIn}).catch(()=>{});};
  const keys=e=>{if(closed)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();return;}if(e.key==='Tab'){const focusable=[...root.querySelectorAll('button,input,select,[tabindex]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}e.stopPropagation();};document.addEventListener('keydown',keys,true);
  q('[data-account-host]').addEventListener('click',e=>{if(busy&&e.target.closest('[data-act]')){e.preventDefault();e.stopImmediatePropagation();say('Please wait for the current save or upload.');}},{capture:true});
  bindAccountCard(q('[data-account-host]'),{onToast:text=>say(text)});
  let accountIdentity=account.cached()?.username||'guest';
  const unsubscribe=account.onChange(me=>{if(closed)return;const next=me?.guest?'guest':me?.username||'';if(next===accountIdentity)return;accountIdentity=next;cancelPhoto();q('[data-account-host]').innerHTML=renderAccountCard();load().catch(e=>say(e.message,true));});
  root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const act=b.dataset.act;
    if(act==='close'){close();return;}if(act==='view-car'||act==='view-driver'){preview?.setView(act==='view-car'?'car':'driver');return;}
    if(b.dataset.layer!==undefined){layerIndex=Number(b.dataset.layer);refresh();return;}
    if(act==='photo'){q('[data-photo-file]').click();return;}if(act==='photo-cancel'){cancelPhoto();return;}
    safely(async()=>{
      if(act==='reload'){await load();return;}
      if(act==='new'){selectedId='';q('[data-name]').value='';refreshPresets();say('Name the new preset, then save.');return;}
      if(['save','rename','duplicate','delete'].includes(act)&&!repository)throw new Error('Load your presets or claim a username first.');
      if(act==='save'){if(signedIn){for(const d of draft.decals){if(d.id!=='photo'||isPublicPhotoSticker(d.assetId))continue;const blob=await resolvePhotoSticker(d.assetId);if(!blob)throw new Error('Photo is missing. Add it again.');const image=await createImageBitmap(blob);const asset=await savePhotoSticker(blob,{signedIn:true,width:image.width,height:image.height});image.close();createdAssets.add(asset.id);d.assetId=asset.id;}}const p=await repository.save(spec.id,q('[data-name]').value,draft,selectedId);selectedId=p.id;draft=normalizeAppearance(p);applyCustomization(spec,p,{onChange});refreshPresets();say(signedIn?'Preset saved to your account and applied.':'Preset saved in this browser and applied.');await refreshAssets();}
      else if(act==='rename'){await repository.rename(selectedId,q('[data-name]').value);refreshPresets();say('Preset renamed.');}
      else if(act==='duplicate'){const p=await repository.duplicate(selectedId,q('[data-name]').value+' copy');selectedId=p.id;q('[data-name]').value=p.name;draft=normalizeAppearance(p);applyCustomization(spec,p,{onChange});refreshPresets();refresh();say('Preset duplicated.');}
      else if(act==='delete'){await repository.delete(selectedId);selectedId='';q('[data-name]').value='';refreshPresets();await refreshAssets();say('Preset deleted. Current look remains available to save.');}
      else if(act==='add'&&draft.decals.length<8){draft.decals.push({id:q('[data-design]').value,position:'bonnet',color:'#ffffff',x:0,y:0,scale:1,rotation:0,flipX:false,number:7});layerIndex=draft.decals.length-1;refresh();}
      else if(act==='layer-remove'){draft.decals.splice(layerIndex,1);layerIndex=Math.min(layerIndex,draft.decals.length-1);refresh();}
      else if(act==='layer-up'||act==='layer-down'){const target=layerIndex+(act==='layer-up'?-1:1);if(target>=0&&target<draft.decals.length){[draft.decals[target],draft.decals[layerIndex]]=[draft.decals[layerIndex],draft.decals[target]];layerIndex=target;refresh();}}
      else if(act==='photo-use'){await updatePhoto();if(!repository)throw new Error('Claim a username or reload presets first.');if(!photoPreview||draft.decals.length>=8)return;const asset=await savePhotoSticker(photoPreview.blob,{signedIn,width:photoPreview.width,height:photoPreview.height});createdAssets.add(asset.id);await preparePhotoUrl(asset.id);draft.decals.push({id:'photo',assetId:asset.id,position:'doors',color:'#ffffff',x:0,y:0,scale:1,rotation:0,flipX:false});layerIndex=draft.decals.length-1;cancelPhoto();refresh();await refreshAssets();say('Photo added. Save the preset to keep it.');}
      else if(b.dataset.assetUse){if(draft.decals.length>=8)throw new Error('Remove a layer first.');draft.decals.push({id:'photo',assetId:b.dataset.assetUse,position:'doors',color:'#ffffff',scale:1});layerIndex=draft.decals.length-1;refresh();}
      else if(b.dataset.assetDelete){if(draft.decals.some(d=>d.assetId===b.dataset.assetDelete))throw new Error('Remove this photo from the current look first.');await deletePhotoSticker(b.dataset.assetDelete,{signedIn});await refreshAssets();say('Photo deleted.');}
    });
  });
  root.addEventListener('input',e=>{const el=e.target;
    if(el.dataset.crop){updatePhoto().catch(err=>say(err.message,true));return;}
    if(el.matches('[data-paint]'))draft.paint=el.value;
    else if(el.dataset.driver){draft.driver[el.dataset.driver]=el.type==='checkbox'?el.checked:['heightCm','hairVolume'].includes(el.dataset.driver)?Number(el.value):el.value;}
    else if(el.dataset.layerField&&draft.decals[layerIndex]){const k=el.dataset.layerField;draft.decals[layerIndex][k]=el.type==='checkbox'?el.checked:['number','x','y','scale','rotation'].includes(k)?Number(el.value):el.value;}
    else return;refresh();
  });
  root.addEventListener('change',e=>{const el=e.target;
    if(el.matches('[data-character-preset]')){const look=characterPresetLook(el.value);if(look)draft.driver=look;else {delete draft.driver.presetId;delete draft.driver.passenger;}refresh();say(look?'Character preset selected. Save & Apply keeps this look.':'Custom character look.');}
    else if(el.matches('[data-preview-angle]'))preview?.setAngle(el.value);
    else if(el.matches('[data-presets]'))safely(async()=>{if(!el.value){selectedId='';refreshPresets();return;}const p=await repository.select(spec.id,el.value);selectedId=p.id;draft=normalizeAppearance(p);q('[data-name]').value=p.name;applyCustomization(spec,p,{onChange});refreshPresets();refresh();say('Preset loaded and applied.');});
    else if(el.matches('[data-factory]')&&el.value){draft.paint=el.value;refresh();}
    else if(el.matches('[data-photo-mode]')){photoMode=el.value;updatePhoto().catch(err=>say(err.message,true));}
    else if(el.matches('[data-photo-file]')&&el.files[0])safely(async()=>{sourceImage?.close();sourceImage=await decodeUserPhoto(el.files[0]);q('[data-photo-crop]').hidden=false;await updatePhoto();say('Frame the photo, then choose USE PHOTO.');});
  });
  opened={close,root,get draft(){return structuredClone(draft);},get repository(){return repository;}};
  try{preview=mountCustomizationPreview(q('[data-preview]'),spec,draft);}catch(e){say('3D preview unavailable: '+e.message,true);}
  await safely(load);return opened;
}
