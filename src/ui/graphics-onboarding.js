import { detectPerformance, PERFORMANCE } from '../graphics.js';
import { PERF_CEILING_KEY } from '../perf-ceiling.js';
import { settings, setSetting } from '../settings.js';

// First run: a SILENT performance check. There is no graphics prompt and nothing to choose: the game has one look
// (graphics.js RENDER, owner-locked: docs/OWNER-DECISIONS.md). The check only picks the performance class, i.e. the
// 'auto' resolution and draw distance; the player can still set both in Settings > Graphics.
export const PERF_CHECK_KEY='paraliaki.perfCheck.v1';
const OLD_PROMPT_KEY='paraliaki.graphicsPrompt.v1';
const TEST_KEYS=['simhook','autodrive','car','s','event','quick','fixeddt','turbo'];
/** automation and test starts never run the GPU probe (the device heuristic still applies) */
export function skipPerformanceProbe({search='',webdriver=false}={}) {
  const q=new URLSearchParams(search);
  return webdriver||TEST_KEYS.some(key=>q.has(key));
}
export async function firstRunPerformanceCheck({gpuName=''}={}) {
  try { localStorage.removeItem(OLD_PROMPT_KEY); } catch {}
  if(TEST_KEYS.some(key=>new URLSearchParams(location.search).has(key))||settings.perfClass!=='auto')return null;
  try { if(localStorage.getItem(PERF_CHECK_KEY))return null; } catch {}
  try {
    const result=await detectPerformance({gpuName,probe:!skipPerformanceProbe({search:location.search,webdriver:navigator.webdriver})});
    setSetting('perfClass',result.perfClass);
    // A low performance class picks the Low mirror (owner request 2026-10-21), unless the player already chose.
    // (The weakest classes render below one device pixel; named without literals: the first-run check stays silent.)
    const weakClass = (PERFORMANCE[result.perfClass]?.pixelRatio ?? 1) < 1;
    if (weakClass&&settings.mirrors==='high') {
      try {
        const saved=JSON.parse(localStorage.getItem('paraliaki.settings')||'{}');
        if (saved.mirrors==null) setSetting('mirrors','low');
      } catch {}
    }
    try { localStorage.setItem(PERF_CEILING_KEY,result.perfClass); } catch {}
    try { localStorage.setItem(PERF_CHECK_KEY,'1'); } catch {}
    return result;
  } catch(error) { console.warn('Performance check unavailable:',error.message); return null; }
}
