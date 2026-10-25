const { contextBridge, ipcRenderer } = require('electron');
// No arbitrary channel, filesystem, shell, or network access crosses this bridge.
contextBridge.exposeInMainWorld('athensDesktop', Object.freeze({
  session: () => ipcRenderer.invoke('athens:session'),
  host: () => ipcRenderer.invoke('athens:host'),
  join: address => ipcRenderer.invoke('athens:join', address),
  solo: () => ipcRenderer.invoke('athens:solo'),
}));

// Drag an existing menu status row instead of covering the game canvas with a
// replacement title bar. Pause opens this same row while driving. Native window
// buttons remain provided by Electron; this bridge gains no window-control IPC.
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.id = 'athens-desktop-window';
  style.textContent = `
    .scr { padding-top: max(28px, var(--pad-screen-y)); }
    body.ui-open #ui .hu-status { -webkit-app-region: drag; }
    body.ui-open #ui .hu-status :is(button, a, input, select, textarea, ui-select, [role="button"], [contenteditable], [tabindex]),
    body.ui-open #ui .hu-status :is(button, a, input, select, textarea, ui-select, [role="button"], [contenteditable], [tabindex]) * { -webkit-app-region: no-drag; }
  `;
  document.head.append(style);
}, { once: true });
