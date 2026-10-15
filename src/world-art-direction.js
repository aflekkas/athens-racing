// Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.
export const WORLD_TRIANGLE_BUDGETS = Object.freeze({
  stairFlight: 256, building: 40, streetProp: 150, sign: 60, pedestrian: 400,
  lamp: 96, gantry: 150, barrierPost: 12,
});
export const WORLD_STYLE = Object.freeze({vegetation:false,beachFurniture:false,buildings:'blocks',terrain:'area-colour-texture',style:'blocky-real-things'});
export function triangleCount(geometry) { return (geometry.index?.count ?? geometry.attributes.position.count)/3; }
export function assertWorldBudget(category, geometry) {
  const count=triangleCount(geometry),max=WORLD_TRIANGLE_BUDGETS[category];
  if(!max || count>max)throw new Error(`Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing. ${category}: ${count} > ${max}`);
  return geometry;
}
