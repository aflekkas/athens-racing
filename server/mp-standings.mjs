import { courseProgress } from '../src/course.js';
// Current directional position along the route, from each driver's invisibly tracked on-road progress.
// One server order is sent to every driver; predicted render poses never rank.
export function raceStandings(lobby, event) {
  const drivers = lobby.status === 'results' ? [...(lobby.racers?.values() || [])] : [...lobby.players.values()];
  const rows = drivers.map(p => {
    const live = lobby.players.get(p.id) || p, course = live.course;
    return { id: p.id, progress: course ? courseProgress(course) : 0, finish: p.finish ?? null, dnf: p.dnf || false };
  });
  rows.sort((a, b) => {
    if (a.finish != null || b.finish != null) return (a.finish ?? Infinity) - (b.finish ?? Infinity) || a.id.localeCompare(b.id);
    return Number(!!a.dnf) - Number(!!b.dnf) || b.progress - a.progress || a.id.localeCompare(b.id);
  });
  return rows.map((p, i) => ({ ...p, position: i + 1 }));
}
