// Explicit diagnostic entry: never creates a baseline PASS or captures photos.
process.env.TERRAIN_DIAGNOSTIC_ONLY='1';
await import('./asphalt-material.browser.mjs');
