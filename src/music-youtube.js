export function parseYouTubeURL(value) {
  let url; try { url = new URL(value); } catch { throw Error('Paste a full YouTube video, live-stream or playlist URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Use an HTTPS YouTube URL.');
  const host = url.hostname.toLowerCase();
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(host)) throw Error('Use a youtube.com or youtu.be URL.');
  const video = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:live|embed|shorts)\/([^/]+)/)?.[1];
  const playlist = url.searchParams.get('list');
  if (video && !/^[A-Za-z0-9_-]{11}$/.test(video)) throw Error('This YouTube video ID is invalid.');
  if (playlist && !/^[A-Za-z0-9_-]{10,150}$/.test(playlist)) throw Error('This YouTube playlist ID is invalid.');
  if (!video && !playlist) throw Error('Use a video, live-stream or playlist URL.');
  return { video, playlist };
}
let apiPromise;
function api() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => { apiPromise = null; reject(Error('YouTube could not load. Check your connection or open the URL on YouTube.')); }, 20000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); resolve(window.YT); };
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); apiPromise = null; script.remove(); reject(Error('YouTube could not load. Open the URL on YouTube.')); };
    document.head.append(script);
  });
  return apiPromise;
}
export class MenuYouTube {
  constructor(mount, message, volumes) {
    this.mount = mount; this.message = message; this.volumes = volumes; this.revision = 0;
    this.visibility = () => { if (!this.visible()) this.player?.pauseVideo?.(); };
    document.addEventListener('visibilitychange', this.visibility);
    this.intersection = new IntersectionObserver(entries => { this.inView = entries[0]?.intersectionRatio >= 0.98; this.visibility(); }, { threshold: [0, 0.98, 1] });
    this.intersection.observe(mount);
  }
  visible() { return !document.hidden && this.mount.isConnected && !this.mount.closest('[hidden]') && this.inView; }
  volume() {
    const { master, music } = this.volumes();
    this.player?.setVolume?.(Math.round(master * music * 100));
  }
  async load(value) {
    const content = parseYouTubeURL(value), revision = ++this.revision;
    this.player?.destroy(); this.player = null; this.mount.replaceChildren();
    this.message('Loading YouTube…');
    const YT = await api(); if (revision !== this.revision || !this.mount.isConnected) return;
    const target = document.createElement('div'); this.mount.append(target);
    this.player = new YT.Player(target, {
      width: '100%', height: '270', videoId: content.video,
      playerVars: { autoplay: 0, controls: 1, playsinline: 1, origin: location.origin, ...(content.playlist ? { listType: 'playlist', list: content.playlist } : {}) },
      events: {
        onReady: () => { this.volume(); this.visibility(); this.message('Press Play in the visible YouTube player. Playback stops when you leave this screen.'); },
        onStateChange: () => this.visibility(),
        onAutoplayBlocked: () => this.message('Press Play in the YouTube player to start.'),
        onError: event => this.message(`YouTube could not play this video (${event.data}). It may be offline, private or blocked from embedding. Open it on YouTube.`),
      },
    });
  }
  destroy() {
    this.revision++; this.player?.pauseVideo?.(); this.player?.destroy(); this.player = null;
    this.intersection.disconnect(); document.removeEventListener('visibilitychange', this.visibility);
  }
}
