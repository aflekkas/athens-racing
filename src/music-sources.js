// Local/built-in music shares the existing music graph, volume and action duck.
const KEY = 'paraliaki.music-source';
export const MUSIC_SOURCES = ['off', 'files', 'youtube', 'builtin'];
export const isMusicFile = file => /^audio\//.test(file.type || '') || /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i.test(file.name || '');
const savedSource = () => { try { const s = localStorage.getItem(KEY); return MUSIC_SOURCES.includes(s) ? s : 'off'; } catch { return 'off'; } };
export class MusicSources {
  constructor(audio) {
    this.audio = audio; this.source = savedSource(); this.files = []; this.index = -1;
    this.shuffle = false; this.history = []; this.listeners = new Set(); this.status = ''; this.revision = 0;
    audio.musicOn = ['files', 'builtin'].includes(this.source);
    if (typeof window !== 'undefined') window.__music = this;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(this); }
  message(text) { this.status = text; this.changed(); }
  attach(enabled = true) { this.enabled = enabled; }
  element() {
    if (!this.el) {
      this.el = new window.Audio(); this.el.preload = 'metadata';
      this.node = this.audio.ctx.createMediaElementSource(this.el);
      this.inputGain = this.audio.ctx.createGain(); this.node.connect(this.inputGain); this.inputGain.connect(this.audio.musicBus); this.syncMenu();
      this.el.addEventListener('ended', () => { if (this.audio.musicOn) void this.next(); });
      this.el.addEventListener('error', () => this.message('This audio file could not be played. Try another track.'));
      this.el.addEventListener('play', () => this.changed());
      this.el.addEventListener('pause', () => this.changed());
    }
    return this.el;
  }
  select(source) {
    if (!MUSIC_SOURCES.includes(source)) return;
    this.pause(); this.revision++; this.source = source; this.index = -1; this.history = []; this.status = '';
    try { localStorage.setItem(KEY, source); } catch {}
    this.audio.musicOn = ['files', 'builtin'].includes(source);
    this.level(); this.syncMenu(); this.changed();
    if (this.audio.ctx && this.audio.musicOn) void this.play();
  }
  syncMenu() {
    // MIX.md: menus about 6 dB below racing. Built-in masters retain their calibrated levels.
    if (!this.inputGain) return;
    const value = this.source === 'files' && this.audio.mix.menu ? 0.35 / 0.62 * 0.5 : 1;
    if (this.menuGain === value) return;
    this.menuGain = value; this.inputGain.gain.setTargetAtTime(value, this.audio.ctx.currentTime, 0.4);
  }
  level() {
    const a = this.audio;
    a.musicBus?.gain.setTargetAtTime(a.musicOn ? a.mix.menu ? 0.62 : 0.35 : 0, a.ctx.currentTime, 0.3);
  }
  async loadFiles(files) {
    this.pause(); this.releaseURL(); this.files = [...files].filter(isMusicFile).sort((a, b) => a.name.localeCompare(b.name));
    this.select('files');
    if (!this.files.length) { this.message('No supported audio files found. Choose MP3, M4A, OGG, WAV or FLAC files.'); return; }
    this.audio.start(); await this.audio.ctx?.resume(); this.level(); await this.play();
  }
  async tracks() {
    if (this.source === 'files') return this.files;
    if (this.source !== 'builtin') return [];
    if (!this.builtin) this.builtin = fetch(new URL('../assets/audio/music/tracks.json', import.meta.url))
      .then(r => { if (!r.ok) throw Error(); return r.json(); }).then(j => j.tracks)
      .catch(() => { this.message('Built-in radio is unavailable. Choose your own files.'); return []; });
    return this.builtin;
  }
  async play() {
    if (!this.enabled || !this.audio.ctx || !this.audio.musicOn || !['files', 'builtin'].includes(this.source)) return;
    const revision = this.revision, tracks = await this.tracks();
    if (revision !== this.revision || !this.audio.musicOn) return;
    if (!tracks.length) { if (this.source === 'files') this.message('Choose music files to start listening.'); return; }
    const el = this.element();
    if (this.index < 0) this.index = 0;
    const track = tracks[this.index];
    if (this.loadedTrack !== track) {
      this.releaseURL(); this.loadedTrack = track;
      el.src = this.source === 'files' ? (this.objectURL = URL.createObjectURL(track)) : new URL('../assets/audio/music/' + track.file, import.meta.url).href;
      el.playbackRate = 1;
    }
    try {
      await this.audio.ctx.resume();
      if (revision !== this.revision || !this.audio.musicOn) return;
      await el.play();
      if (revision !== this.revision || !this.audio.musicOn) {
        // A newer source owns the same element; an old play promise must not pause it.
        if (!this.audio.musicOn) el.pause();
        return;
      }
      this.message(this.source === 'files' ? track.name : track.title + ' · ' + track.artist);
      if (this.source === 'builtin') this.audio.onTrack?.(track);
    } catch { if (revision === this.revision) this.message('Press Play to start music. Your browser may require a click.'); }
  }
  pause() { this.el?.pause(); }
  async next(direction = 1) {
    if (!['files', 'builtin'].includes(this.source)) return;
    const revision = this.revision, tracks = await this.tracks();
    if (revision !== this.revision || !tracks.length) return;
    if (direction < 0 && this.shuffle && this.history.length) this.index = this.history.pop();
    else {
      if (direction > 0 && this.index >= 0) this.history.push(this.index);
      if (this.history.length > 100) this.history.shift();
      this.index = this.shuffle && tracks.length > 1 && direction > 0
        ? (this.index + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length
        : (this.index + direction + tracks.length) % tracks.length;
    }
    this.audio.musicOn = true; this.level(); await this.play();
  }
  toggle() {
    if (!['files', 'builtin'].includes(this.source)) return false;
    this.audio.start(); this.audio.musicOn = !this.audio.musicOn; this.level();
    if (this.audio.musicOn) void this.play(); else this.pause(); this.changed(); return this.audio.musicOn;
  }
  set rate(value) { if (this.el) this.el.playbackRate = value; }
  releaseURL() { if (this.objectURL) URL.revokeObjectURL(this.objectURL); this.objectURL = null; this.loadedTrack = null; }
}
