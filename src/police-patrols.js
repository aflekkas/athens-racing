// Sparse gameplay placements anchored to map landmarks and actual junctions.
// These are plausible patrol locations, not a claim about real police deployment.
export function patrolPlan(route, data = {}, junctions = []) {
  const marks = data.marks || [];
  const mark = id => marks.find(m => m.id === id)?.s;
  const atJunction = s => {
    const near = junctions.reduce((best, j) => !best || Math.abs(j.s - s) < Math.abs(best.s - s) ? j : best, null);
    return near && Math.abs(near.s - s) < 400 ? near.s : s;
  };
  const fixed = (id, s, moto = false) => ({ id, s, dir: 1, fixed: true, moto });
  const roam = (id, fraction, dir) => ({ id, s: route.length * fraction, dir, fixed: false, moto: dir < 0 });
  let sites = [];
  if (mark('astir') != null && mark('varkiza') != null) {
    // A car coming towards you from Limanakia, Limanakia, Varkiza, one long straight and the coast junction: a unit every
    // 1-2 minutes of race pace in either direction, none parked at a start grid (you'd be warned leaving it).
    let straight = Math.min(route.length - 200, mark('varkiza') + 1400), best = Infinity;
    for (let s = mark('varkiza') + 900; s < Math.min(route.length - 200, mark('varkiza') + 2300); s += 40) {
      const bend = Math.max(...[-60, -30, 0, 30, 60].map(d => Math.abs(route.curv(s + d))));
      if (bend < best) { best = bend; straight = s; }
    }
    sites = [fixed('limanakia', atJunction(mark('limanakia'))), fixed('varkiza-junction', atJunction(mark('varkiza'))),
      fixed('coast-speed-trap', straight), fixed('coast-junction', atJunction(mark('coast'))), roam('coast-roam', .2, -1)];
  } else if (mark('dionysos') != null) {
    // Off the Dionysos grid: Rapentosa (a motorbike), Agios Petros, the top of the climb, and a car coming down.
    sites = [fixed('rapentosa', atJunction(mark('rapentosa')), true), fixed('agios-petros', atJunction(mark('agios-petros'))),
      fixed('penteli-climb', atJunction(mark('penteli-climb'))), roam('penteli-roam', .45, -1)];
  } else if (marks.length && !route.closed) {
    sites = [fixed('village-patrol', atJunction(marks[0].s)), roam('road-roam', .7, 1)];
  } else if (route.closed) {
    sites = [roam('circuit-patrol', .65, 1)]; // only explicit Police On/free roam permits this
  }
  return sites.filter(p => Number.isFinite(p.s) && p.s > 30 && p.s < route.length - 30);
}
