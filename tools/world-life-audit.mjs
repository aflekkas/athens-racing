// Run auditPeople against the real loaded crowd/assets (browser evidence job uses this).
// Route is sampled in non-overlapping 500 m cells; reset spawns the local population,
// then only residents inside that cell are counted. This is a spatial sample, not a global pool size.
export function auditPeople(people, setConditions, resetSeed) {
  const rows = [], r = people.route;
  for (const hour of [8, 14, 21, 3]) for (const weather of ['clear', 'rain']) {
    setConditions(hour, weather); resetSeed(); const counts = { town: 0, beach: 0, cove: 0, village: 0, 'mountain/forest': 0 }, kinds = {};
    for (let start = 0; start < r.length; start += 500) {
      people.reset(start + 60);
      for (const p of people.peds) if (p.active) {
        const s = p.rs ? p.s : p.anchor.s;
        if (s < start || s >= Math.min(start + 500, r.length)) continue;
        // Shore swimmers/sunbeds occupy the beach, even when the road above is a cliff section.
        const shore = people.map.id === 'riviera' && ['beach', 'swim', 'lie', 'wander'].includes(p.kind);
        const zone = shore ? 'beach' : people.map.id === 'penteli' && r.district(s) === 'town' ? 'village' : people.policy.zone(s, p.side || 1).zone;
        counts[zone] = (counts[zone] || 0) + 1; kinds[p.kind] = (kinds[p.kind] || 0) + 1;
      }
    }
    rows.push({ map: people.map.id, hour, weather, ...counts, kinds });
  }
  return rows;
}
export function auditMarkdown(rows) {
  return ['| Map / time | Weather | Town | Beach | Cove | Village | Mountain/forest |', '|---|---|---:|---:|---:|---:|---:|', ...rows.map(r => `| ${r.map} ${String(r.hour).padStart(2, '0')}:00 | ${r.weather} | ${r.town} | ${r.beach} | ${r.cove} | ${r.village} | ${r['mountain/forest']} |`)].join('\n');
}
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('world-life-audit.mjs')) {
  const fs = await import('node:fs/promises');
  const report = JSON.parse(await fs.readFile(process.argv[2] || '.scratch/world-life/evidence/browser-report.json'));
  console.log(auditMarkdown(report.audit));
}
