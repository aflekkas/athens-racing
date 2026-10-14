// Accepted checkpoint cursor first, bounded distance within its segment second.
// One server order is sent to every driver; predicted render poses never rank.
export function raceStandings(lobby, event) {
  const drivers = lobby.status === 'results' ? [...(lobby.racers?.values() || [])] : [...lobby.players.values()];
  const rows = drivers.map(p => {
    const live = lobby.players.get(p.id) || p, course = live.course;
    const checkpoint = course?.passed || 0;
    const lower = checkpoint ? course.gates[checkpoint - 1].d : 0;
    const upper = course?.gates[checkpoint]?.d ?? event.len ?? Math.abs(event.s1 - event.s0);
    const distance = Math.max(0, Math.min(upper - lower, (live.state?.s - event.s0) * event.dir - lower || 0));
    return { id: p.id, checkpoint, distance, progress: lower + distance, finish: p.finish ?? null, dnf: p.dnf || false };
  });
  rows.sort((a, b) => {
    if (a.finish != null || b.finish != null) return (a.finish ?? Infinity) - (b.finish ?? Infinity) || a.id.localeCompare(b.id);
    return Number(!!a.dnf) - Number(!!b.dnf) || b.checkpoint - a.checkpoint || b.distance - a.distance || a.id.localeCompare(b.id);
  });
  return rows.map((p, i) => ({ ...p, position: i + 1 }));
}
