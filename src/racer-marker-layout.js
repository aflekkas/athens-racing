// Projected anchors are bottom-centred, matching the shared racer's CSS transform.
// Stable IDs keep crowded fields deterministic as racers enter and leave view.
export function layoutRacerMarkers(markers, width, height) {
  const placed = [], gap = 4, margin = 8;
  for (const marker of [...markers].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const w = marker.width, h = marker.height;
    const x = Math.max(margin + w / 2, Math.min(width - margin - w / 2, marker.x));
    const clampY = y => Math.max(margin + h, Math.min(height - margin, y));
    const base = clampY(marker.y);
    const neighbours = placed.filter(p => Math.abs(p.x - x) < (p.width + w) / 2 + gap);
    const candidates = [base, ...neighbours.flatMap(p => [p.y - p.height - gap, p.y + gap + h])]
      .map(clampY).sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || a - b);
    const y = candidates.find(y => neighbours.every(p => y <= p.y - p.height - gap || y - h >= p.y + gap)) ?? base;
    placed.push({ ...marker, x, y });
  }
  return placed;
}
