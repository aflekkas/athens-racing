// Panels owned by other modules (the multiplayer lobby #multiplayer, the replay / photo bar #replay-controls) get the
// UI kit's custom Select / Slider / Toggle in place of their native controls (components.js autoEnhance) as soon as
// they appear in the document; their own code keeps reading and writing the (now hidden) native elements.
import { autoEnhance } from './components.js';

const HOSTS = ['multiplayer', 'replay-controls'];
function scan() { for (const id of HOSTS) { const el = document.getElementById(id); if (el) autoEnhance(el); } }
if (typeof document !== 'undefined') {
  scan();
  const mo = new MutationObserver(() => { scan(); if (HOSTS.every((id) => document.getElementById(id)?.__uiAuto)) mo.disconnect(); });
  mo.observe(document.body, { childList: true });
}
