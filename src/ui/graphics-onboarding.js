import * as graphics from '../graphics.js';
import { ui } from './components.js';

export const QUALITY_PROMPT_KEY='paraliaki.graphicsPrompt.v1';
const TEST_KEYS=['simhook','autodrive','car','s','event','quick','fixeddt','turbo'];
export function skipQualityProbe({search='',webdriver=false}={}) {
  const q=new URLSearchParams(search);
  return webdriver||q.has('quality')||TEST_KEYS.some(key=>q.has(key));
}
let pending=null;
export async function firstQualityPreference(preference,{gpuName=''}={}) {
  const q=new URLSearchParams(location.search);
  if(q.has('quality')||TEST_KEYS.some(key=>q.has(key)))return preference;
  try { if(localStorage.getItem('paraliaki.graphics')||localStorage.getItem(QUALITY_PROMPT_KEY))return preference; } catch {}
  if(preference!=='auto'||typeof graphics.detectQualityTier!=='function'||typeof graphics.applyQualityTier!=='function')return preference;
  try {
    const result=await graphics.detectQualityTier({gpuName,probe:!skipQualityProbe({search:location.search,webdriver:navigator.webdriver})});
    pending=result;graphics.applyQualityTier(result.tier,{reload:false});return result.tier;
  }catch(error){console.warn('Graphics detection unavailable:',error.message);return preference;}
}
export function mountGraphicsOnboarding(menu) {
  if(!pending)return;
  const show=async()=>{
    if(!pending||menu.screen!=='title'||document.querySelector('#loading.open')||document.querySelector('#multiplayer:not([hidden])'))return;
    const result=pending;pending=null;observer.disconnect();
    try {localStorage.setItem(QUALITY_PROMPT_KEY,'seen');}catch{}
    const labels={potato:'Potato',low:'Low',med:'Medium',high:'High'};
    const chosen=await ui.prompt({title:'Graphics preset: '+labels[result.tier],body:'Picked once for this device and kept fixed. Change it, or fine-tune lighting, effects and resolution, anytime in Settings › Graphics.',icon:'monitor',dismissible:false,actions:['potato','low','med','high'].map(id=>({id,label:labels[id],default:id===result.tier,variant:id===result.tier?'primary':'secondary'}))});
    if(chosen)graphics.applyQualityTier(chosen,{current:result.tier});
  };
  const observer=new MutationObserver(show);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden','data-ui']});setTimeout(show,0);
}
