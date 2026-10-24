// Enhancement only; no network probing, storage or analytics.
(() => {
  const release = window.ATHENS_RELEASE || {};
  const safeURL = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash && /^\/aflekkas\/athens-racing\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  };
  let available = 0;
  for (const card of document.querySelectorAll('[data-os]')) {
    const artifact = release.artifacts?.[card.dataset.os] || {};
    const url = artifact.url && safeURL(artifact.url);
    const live = Boolean(url && artifact.nativeVerified === true && /^[a-f0-9]{64}$/i.test(artifact.sha256 || '') && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0 && typeof release.version === 'string' && release.version.trim());
    card.hidden = card.dataset.os === 'linux' && !live;
    if (!live) continue;
    available++;
    const button = card.querySelector('.dl-btn');
    const link = document.createElement('a');
    link.className = button.className;
    link.href = url;
    link.append(button.querySelector('svg').cloneNode(true));
    const label = document.createElement('span');
    label.textContent = 'Download ' + artifact.file;
    link.append(label);
    button.replaceWith(link);
    card.classList.add('is-live');
    card.querySelector('.dl-state').textContent = 'Available';
    const meta = card.querySelector('.dl-meta');
    meta.replaceChildren();
    for (const [key, value] of [['Version', release.version], ['Size', (artifact.bytes / 1048576).toFixed(0) + ' MiB'], ['SHA-256', artifact.sha256], ['Install', artifact.installNote]]) {
      if (!value) continue;
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = key; dd.textContent = value; meta.append(dt, dd);
    }
  }
  if (available) {
    document.getElementById('release-status').textContent = 'Version ' + release.version + ' · Download the build for your computer.';
    document.getElementById('hero-status').textContent = 'Offline solo and player-hosted LAN.';
  }
})();
