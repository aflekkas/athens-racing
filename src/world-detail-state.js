import { settings, onSettings } from './settings.js';
// Shared uniform objects survive material cloning and map switches.
export const worldDetailEnabled = { value: settings.worldDetail !== false ? 1 : 0 };
onSettings(s => { worldDetailEnabled.value = s.worldDetail !== false ? 1 : 0; });
