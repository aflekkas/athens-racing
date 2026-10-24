import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { startDesktopRuntime } from '../server/runtime.mjs';
import { assertJoinAddress, assertTrustedSender, rendererRequestAllowed, trustedURL, gamePermissionAllowed, trustedResultDownload, RESULT_DOWNLOAD_MAX_BYTES } from './security.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '../..');
let runtime, window, quitting = false, mutation = Promise.resolve();
// Main-process overrides support isolated local verification; the renderer cannot set them.
if (process.env.ASR_DESKTOP_USER_DATA) {
  const profile = resolve(process.env.ASR_DESKTOP_USER_DATA);
  mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
}
const desktopPort = Number(process.env.ASR_DESKTOP_PORT || 17833);
if (!Number.isInteger(desktopPort) || desktopPort < 1 || desktopPort > 65535) throw Error('Invalid desktop port.');

// A second process must not race for the fixed origin or corrupt local saves.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !runtime) return;
    event.preventDefault(); quitting = true;
    Promise.resolve(mutation).catch(() => {}).then(() => runtime.close())
      .catch(error => console.error('Could not close local game server:', error))
      .finally(() => app.quit());
  });
  app.whenReady().then(start).catch(error => {
    const detail = error.code === 'EADDRINUSE'
      ? `The local game port ${desktopPort} is already in use. Close the other Athens Racing instance or the program using that port, then try again.`
      : error.message;
    dialog.showErrorBox('Athens Racing could not start', detail);
    app.quit();
  });
}

async function start() {
  const root = app.isPackaged ? resolve(process.resourcesPath, 'game')
    : resolve(process.env.ASR_GAME_ROOT || resolve(projectRoot, '.desktop/game'));
  runtime = await startDesktopRuntime({ root, dataDir: resolve(app.getPath('userData'), 'saves'), port: desktopPort });
  const origin = new URL(runtime.url).origin;
  // Persistent partition + fixed localhost origin keep settings/profile across restarts.
  const gameSession = session.fromPartition('persist:athens-racing');
  const allowedPermission = (contents, permission, details) => !!window && !window.isDestroyed() && contents === window.webContents && gamePermissionAllowed(permission, details?.requestingUrl, origin, details?.isMainFrame);
  gameSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(allowedPermission(contents, permission, details)));
  gameSession.setPermissionCheckHandler((contents, permission, _requestingOrigin, details) => allowedPermission(contents, permission, details));
  gameSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !rendererRequestAllowed(details.url, origin) });
  });
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 650,
    title: 'Athens Racing', backgroundColor: '#080b10', autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(here, 'preload.cjs'), session: gameSession,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!trustedURL(url, origin)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!trustedURL(url, origin)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  let resultDownloadActive = false;
  gameSession.on('will-download', (event, item, contents, frame) => {
    if (resultDownloadActive || !trustedResultDownload(item, contents, frame, window, origin)) { event.preventDefault(); return; }
    resultDownloadActive = true;
    item.setSaveDialogOptions({ title: 'Save race result', defaultPath: 'athens-racing-result.png', buttonLabel: 'Save image', filters: [{ name: 'PNG image', extensions: ['png'] }] });
    item.on('updated', () => { if (item.getReceivedBytes() > RESULT_DOWNLOAD_MAX_BYTES || item.getTotalBytes() > RESULT_DOWNLOAD_MAX_BYTES) item.cancel(); });
    item.once('done', () => { resultDownloadActive = false; });
  });
  const guard = event => assertTrustedSender(event, window, origin);
  ipcMain.handle('athens:session', event => { guard(event); return runtime.getSession(); });
  for (const operation of ['host', 'join', 'solo']) {
    ipcMain.handle(`athens:${operation}`, (event, ...args) => {
      guard(event);
      if (quitting) throw new Error('Athens Racing is closing.');
      if (operation === 'join') assertJoinAddress(args[0]);
      const next = mutation.then(() => runtime[operation](...args));
      mutation = next.catch(() => {});
      return next;
    });
  }
  await window.loadURL(runtime.url);
}
