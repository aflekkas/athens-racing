// Owner-locked limits, measured on the real drawable model including wheels.
// Resident hidden crash internals are reported separately; LOD levels never sum.
export const OWNER_VEHICLE_DECISION='Owner-locked decision, see docs/OWNER-DECISIONS.md. Ask the owner before changing.';
export const VEHICLE_BUDGETS=Object.freeze({
  exterior:4000,
  commercialExterior:5000,
  lod1:999,
  lod2:299,
  wheel:149,
  cockpit:12000,
  bikeRider:599,
  enclosedOccupants:0,
  cockpitGlass:0,
});
export function vehicleBudget(spec){return Object.freeze({...VEHICLE_BUDGETS,exterior:['bus','truck'].includes(spec.nativeFleet)?VEHICLE_BUDGETS.commercialExterior:VEHICLE_BUDGETS.exterior});}
