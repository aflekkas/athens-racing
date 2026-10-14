// Registers the offline cache (/sw.js, built from src/service-worker.js) on deploy builds only:
// tools/prepare-deploy.mjs adds <meta name="asr-build"> and this script to index.html. ?nosw removes it.
const build = document.querySelector('meta[name="asr-build"]')?.content;
if ('serviceWorker' in navigator) {
  if (!build || new URLSearchParams(location.search).has('nosw')) {
    navigator.serviceWorker.getRegistrations().then(list => list.forEach(r => r.unregister())).catch(() => {});
    globalThis.caches?.keys().then(names => names.filter(n => n.startsWith('asr-')).forEach(n => caches.delete(n))).catch(() => {});
  } else {
    // After the game has loaded: the install step copies what this load already put in the HTTP cache.
    const register = () => setTimeout(() => navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(e => console.warn('Offline cache unavailable:', e.message)), 2500);
    const loaded = () => document.body.classList.contains('loaded');
    if (loaded()) register();
    else new MutationObserver((_, o) => { if (loaded()) { o.disconnect(); register(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
}
