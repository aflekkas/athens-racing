import { icon } from './ui/components.js';
import { settings, onSettings } from './settings.js';
import { SPOTIFY_CLIENT_ID } from './music-config.js';
import { savedHandles, filesFromHandles } from './music-library.js';
import { MenuYouTube, parseYouTubeURL } from './music-youtube.js';

export function installMusicSettings(menu) {
  if (!document.querySelector('link[data-music-style]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./music-settings.css', import.meta.url); css.dataset.musicStyle = ''; document.head.append(css);
  }
  let mounted, unsubscribe, youtube, music;
  function clear() { unsubscribe?.(); unsubscribe = null; youtube?.destroy(); youtube = null; mounted = null; }
  function mount() {
    if (mounted && !mounted.isConnected) clear();
    if (menu.screen !== 'settings' || (menu.data.tab || 'audio') !== 'audio') { if (mounted) clear(); return; }
    const panel = menu.root.querySelector('.set-panel');
    music = window.__music;
    if (!panel || !music || mounted?.isConnected) return;
    const section = mounted = document.createElement('section'); section.className = 'group music-settings'; section.id = 'music-source-settings';
    section.innerHTML = `<h3 class="group__title">${icon('music-notes')}MUSIC SOURCE</h3>
      <label>LISTEN TO<select aria-label="Music source"><option value="off">Off</option><option value="files">Your music files</option><option value="spotify">Spotify</option><option value="youtube">YouTube stream / playlist URL</option><option value="builtin">Built-in radio</option></select></label>
      <div data-source="off"><p>Music is off. Choose a source whenever you want.</p></div>
      <div data-source="files"><p>Your files stay on this device. Music volume and the car’s audio mix apply.</p><div class="music-actions"><button type="button" data-files>Choose files</button><button type="button" data-folder>Choose folder</button><button type="button" data-restore>Restore saved files</button><button type="button" data-forget>Forget saved files</button></div><input type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.webm" multiple hidden data-file-input><input type="file" webkitdirectory multiple hidden data-folder-input></div>
      <div data-source="spotify"><p>Premium required for in-browser playback and Spotify Connect API control. Spotify’s current policy prevents integration into games. Use Spotify separately.</p><p data-spotify-setup></p><div class="music-actions"><a href="https://open.spotify.com/" target="_blank" rel="noopener">Open Spotify</a></div><p>Control listening in Spotify. The game’s music volume and keys do not control the external app.</p></div>
      <div data-source="youtube"><p>Menu-only video player. Keep it visible; playback pauses when hidden, scrolled away or when you return to driving. Use the player’s own controls.</p><label>YOUTUBE URL<input type="url" placeholder="https://www.youtube.com/watch?v=…" data-youtube-url></label><div class="music-actions"><button type="button" data-youtube-load>Load player</button><a data-youtube-link target="_blank" rel="noopener" hidden>Open on YouTube</a></div><p>Loading connects to YouTube and is subject to <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube’s terms</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google’s privacy policy</a>.</p><div class="music-youtube" hidden></div></div>
      <div data-source="builtin"><p>The original bundled tracks, available by choice.</p></div>
      <div class="music-actions" data-transport><button type="button" data-prev>Previous</button><button type="button" data-play>Play</button><button type="button" data-next>Next · N</button><button type="button" data-shuffle aria-pressed="false">Shuffle</button></div>
      <p class="music-status" role="status" aria-live="polite"></p><p data-key-note>J: music mute · N: next track · M: transmission</p>`;
    // These native controls keep browser file/iframe gestures; do not bubble into menu navigation.
    section.addEventListener('click', e => e.stopPropagation());
    section.addEventListener('keydown', e => { if (e.code !== 'Escape') e.stopPropagation(); });
    section.addEventListener('change', e => e.stopPropagation());
    const placeholder = panel.querySelector('#music-source-settings');
    if (placeholder) placeholder.replaceWith(section); else panel.prepend(section);
    const q = selector => section.querySelector(selector), status = text => { q('.music-status').textContent = text; };
    q('[data-spotify-setup]').textContent = SPOTIFY_CLIENT_ID ? 'Client ID configured. In-game playback remains unavailable under Spotify’s current policy.' : 'Spotify is not connected. No client ID is configured; owner setup and Spotify permission are required.';
    const update = () => {
      q('select').value = music.source;
      for (const child of section.querySelectorAll('[data-source]')) child.hidden = child.dataset.source !== music.source;
      q('[data-transport]').hidden = !['files', 'builtin'].includes(music.source);
      q('[data-key-note]').hidden = !['files', 'builtin'].includes(music.source);
      q('[data-play]').textContent = music.audio.musicOn && music.el && !music.el.paused ? 'Pause · J' : 'Play · J';
      q('[data-shuffle]').setAttribute('aria-pressed', String(music.shuffle));
      q('[data-shuffle]').textContent = music.shuffle ? 'Shuffle on' : 'Shuffle off';
      status(music.status);
      if (music.source !== 'youtube' && youtube) { youtube.destroy(); youtube = null; q('.music-youtube').replaceChildren(); q('.music-youtube').hidden = true; }
    };
    unsubscribe = music.subscribe(update); update();
    q('select').onchange = e => { music.select(e.target.value); if (['files', 'builtin'].includes(music.source)) { music.audio.start(); void music.play(); } };
    const run = task => async () => { try { await task(); } catch (error) { if (error.name !== 'AbortError') status(error.message || 'Could not access your music. Choose the files again.'); } };
    const load = async handles => {
      const files = await filesFromHandles(handles); await music.loadFiles(files);
      try { await savedHandles(handles); } catch { status('Playing your files. This browser could not remember them for another visit.'); }
    };
    q('[data-files]').onclick = run(async () => {
      if (window.showOpenFilePicker) await load(await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Music', accept: { 'audio/*': ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac', '.webm'] } }] }));
      else q('[data-file-input]').click();
    });
    q('[data-folder]').onclick = run(async () => {
      if (window.showDirectoryPicker) await load([await window.showDirectoryPicker({ mode: 'read' })]);
      else q('[data-folder-input]').click();
    });
    for (const input of section.querySelectorAll('input[type=file]')) input.onchange = run(async () => { await music.loadFiles(input.files); input.value = ''; });
    q('[data-restore]').onclick = run(async () => { const handles = await savedHandles(); if (!handles.length) { status('No saved file handles. Choose files or a folder first.'); return; } await music.loadFiles(await filesFromHandles(handles, true)); });
    q('[data-forget]').onclick = run(async () => { await savedHandles([]); music.pause(); music.files = []; music.releaseURL(); music.select('off'); status('Saved file access forgotten.'); });
    q('[data-play]').onclick = () => music.toggle();
    q('[data-next]').onclick = () => { music.audio.start(); void music.next(); };
    q('[data-prev]').onclick = () => { music.audio.start(); void music.next(-1); };
    q('[data-shuffle]').onclick = () => { music.shuffle = !music.shuffle; music.changed(); };
    const urlInput = q('[data-youtube-url]');
    try { urlInput.value = localStorage.getItem('paraliaki.youtube-url') || ''; } catch {}
    q('[data-youtube-load]').onclick = run(async () => {
      parseYouTubeURL(urlInput.value); // Validate before connecting to any external service.
      const mount = q('.music-youtube'); mount.hidden = false;
      youtube ||= new MenuYouTube(mount, status, () => settings);
      const link = q('[data-youtube-link]'); link.href = urlInput.value; link.hidden = false;
      try { localStorage.setItem('paraliaki.youtube-url', urlInput.value); } catch {}
      await youtube.load(urlInput.value);
    });
  }
  const observer = new MutationObserver(mount); observer.observe(menu.root, { childList: true, subtree: true });
  onSettings(() => youtube?.volume()); mount();
}
