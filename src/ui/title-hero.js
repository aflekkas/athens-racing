import { importWithUpdate } from '../client-release.js';
// No renderer, model or texture work is allowed before the menu has painted.
// This controller is cancellable while its dynamic import / shader compilation is pending.
export function mountTitleHero(root, spec, paint) {
  const host = root.querySelector('[data-title-hero]');
  let stopped = false, first, second, idle, timer, studio, observer;
  const start = async () => {
    if (stopped || !host?.isConnected) return;
    try {
      const { createHeroStudio } = await importWithUpdate(() => import('../title-hero-studio.js'));
      if (stopped || !host?.isConnected) return;
      studio = createHeroStudio();
      studio.setVehicle(spec, paint);
      const draw = async () => {
        if (stopped || !host.isConnected) return;
        await studio.draw(host.clientWidth, host.clientHeight);
        if (!stopped) { host.dataset.ready = 'true'; host.append(studio.canvas); }
      };
      observer = new ResizeObserver(() => { void draw(); }); observer.observe(host);
      await draw();
    } catch (error) { if (!stopped) { host.dataset.error = 'true'; console.warn('Title car preview unavailable', error); } }
  };
  first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
    if (stopped) return;
    if ('requestIdleCallback' in window) idle = requestIdleCallback(start, { timeout: 1800 });
    else timer = setTimeout(start, 80);
  }); });
  return { dispose() { stopped = true; cancelAnimationFrame(first); cancelAnimationFrame(second); if (idle != null) cancelIdleCallback(idle); clearTimeout(timer); observer?.disconnect(); studio?.canvas.remove(); studio?.dispose(); if(host) delete host.dataset.ready; } };
}
