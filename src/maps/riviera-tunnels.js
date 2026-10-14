// Karamanlis / Loumbarda twin bores, NOT the Limanakia coves.
// OSM way geometry downloaded 2026-10-14. Axis points follow increasing race s.
// Width is an 8 m two-lane carriageway reconstruction; OSM has no surveyed width.
// Reference photos / provenance: tools/riviera-landmarks.md.
export const RIVIERA_TUNNELS = Object.freeze([
  Object.freeze({ id: 'loumbarda-east', sourceWayId: 25371523, direction: 1, width: 8,
    portalS: [9471.3101, 9493.8244], transitionS: [9300, 9660],
    axis: Object.freeze([[5615.61478,2268.00441],[5612.54257,2244.96219]].map(Object.freeze)),
    latlon: Object.freeze([[37.8145663,23.8337928],[37.8147739,23.8337579]].map(Object.freeze)) }),
  Object.freeze({ id: 'loumbarda-west', sourceWayId: 172988026, direction: -1, width: 8,
    portalS: [9427.6899, 9503.4423], transitionS: [9270, 9670],
    axis: Object.freeze([[5581.37151,2284.43142],[5587.72720,2278.33789],[5592.19027,2270.57945],[5595.79065,2263.22059],[5597.86814,2254.62971],[5598.87167,2237.53674]].map(Object.freeze)),
    latlon: Object.freeze([[37.8144183,23.8334038],[37.8144732,23.8334760],[37.8145431,23.8335267],[37.8146094,23.8335676],[37.8146868,23.8335912],[37.8148408,23.8336026]].map(Object.freeze)) }),
]);
