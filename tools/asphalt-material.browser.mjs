// Dedicated actual-game asphalt entry. No browser may run without a parent grant.
// Reuses the existing native paused-nine-cell/fixed24-step protocol, source pins,
// full-scene compile, foreground-safe packet picks and strict resource checks.
process.env.TERRAIN_TARGET='asphalt';
await import('./terrain-material.browser.mjs');
