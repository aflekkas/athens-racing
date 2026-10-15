// Private simulations must not leave world actors or damage behind online.
const previous = new WeakMap();
export function onlineWorldVisibility(online, { people, fx, splash }) {
  const changed = previous.get(fx) !== online; previous.set(fx, online);
  if (changed) {
    fx.clearMarks();
    for (const p of [fx.smoke, fx.grit, fx.sparkP]) {
      p.life.fill(0); p.alpha.fill(0); p.pos.fill(-1e5); p.live = 0;
      p.pts.geometry.attributes.position.needsUpdate = p.pts.geometry.attributes.aAlpha.needsUpdate = true;
    }
  }
  for (const p of [fx.smoke, fx.grit, fx.sparkP]) p.pts.visible = !online;
  fx.marks.visible = !online;
  if (online) for (const b of fx.blurPool || []) b.group.visible = false;
  if (online) {
    if (splash) { splash.t = 9; splash.life.fill(0); splash.pts.visible = splash.ring.visible = false; }
    for (const b of people.bodies?.bodies || []) if (b.kind !== 'rider') b.active = false;
    people.crowd.begin(); people.crowd.end(); people.onRoad.length = 0; people.events.length = 0;
  }
}
