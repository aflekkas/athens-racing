// The cabin's handbrake (owner decision 2026-10-20, docs/OWNER-DECISIONS.md, "Handbrake shown in the cabin": "in cars, when the
// handbrake is pulled make sure it is pulled"). One shared control for every cockpit, driven by the same held-handbrake flag:
//   lever ... a mechanical handbrake: the lever swings up to its pulled position while the handbrake is held and drops back when
//             it is released, with a gaiter at its foot and a release button on the grip.
//   button .. a car with an electric parking brake: its P button sinks in and its red ring lights while the handbrake is held.
// The instrument cluster's handbrake lamp (cockpit-telltales.js) lights in every car, electric or not.
import * as THREE from './vehicle-primitives.js';
// Cars that carry an electric parking brake instead of a lever (the rest of the garage has a mechanical one).
const ELECTRIC = new Set(['golf_r', 'z4', 'gla45', 'cla45s', 'cle53', 'superb_4x4', 'octavia_rs', 'qashqai', 'atto3', 'dolphin', 'police_octavia',
  'corolla', 'sl65', 'carrera_gts', 'huracan', 'aventador_svj']);
export const hasElectricHandbrake = spec => ELECTRIC.has(spec?.id);
export const HANDBRAKE_REST = -.04, HANDBRAKE_PULLED = .66; // lever angle about X (rad): the grip points forward and rises when pulled
const RESPONSE = 18; // 1/s: the lever reaches its stop in about a tenth of a second
const mat = (color, roughness = .6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });

/** Builds the control at `at` (the top of the console, local to `parent`) and returns { kind, group, update(dt, held), pull, grip }.
 *  name: prefix for the parts (cockpit structure tests ignore the 'handbrake-' parts). */
export function buildHandbrake(parent, spec, at, { dark = mat('#1b1e21', .8), alu = mat('#a9b0b6', .35, .85) } = {}) {
  const group = new THREE.Group(); group.name = 'handbrake'; group.position.copy(at); parent.add(group);
  const add = (target, geometry, material, x, y, z, name) => { const o = new THREE.Mesh(geometry, material); o.position.set(x, y, z); o.name = name; target.add(o); return o; };
  if (hasElectricHandbrake(spec)) {
    const off = new THREE.MeshBasicMaterial({ color: '#1d1011', toneMapped: false });
    const button = new THREE.Group(); button.name = 'handbrake-button'; group.add(button);
    add(group, new THREE.BoxGeometry(.05, .006, .05), dark, 0, .003, 0, 'handbrake-bezel');
    add(button, new THREE.BoxGeometry(.034, .012, .034), alu, 0, .012, 0, 'handbrake-button-cap');
    const ring = add(button, new THREE.BoxGeometry(.026, .003, .026), off, 0, .0195, 0, 'handbrake-button-lamp');
    const state = { kind: 'button', group, grip: button, pull: 0, lamp: off,
      update(dt, held) {
        this.pull += ((held ? 1 : 0) - this.pull) * (1 - Math.exp(-RESPONSE * Math.max(0, dt)));
        button.position.y = -.005 * this.pull; // the button sinks in
        off.color.setRGB(.12 + .88 * this.pull, .06 - .04 * this.pull, .065 - .045 * this.pull); // dark, then the lit red lamp
        return button.position;
      } };
    return state;
  }
  add(group, new THREE.BoxGeometry(.062, .012, .13), dark, 0, .004, -.07, 'handbrake-gaiter'); // the boot the lever rises through
  const pivot = new THREE.Group(); pivot.name = 'handbrake-pivot'; pivot.position.y = .014; pivot.rotation.x = HANDBRAKE_REST; group.add(pivot);
  add(pivot, new THREE.BoxGeometry(.016, .016, .225), alu, 0, 0, -.1125, 'handbrake-arm');
  const grip = add(pivot, new THREE.BoxGeometry(.034, .032, .085), dark, 0, 0, -.19, 'handbrake-grip');
  add(pivot, new THREE.BoxGeometry(.016, .008, .02), alu, 0, .02, -.225, 'handbrake-release');
  const tip = new THREE.Vector3(0, 0, -.19);
  return { kind: 'lever', group, pivot, grip, pull: 0,
    update(dt, held) {
      this.pull += ((held ? 1 : 0) - this.pull) * (1 - Math.exp(-RESPONSE * Math.max(0, dt)));
      pivot.rotation.x = HANDBRAKE_REST + (HANDBRAKE_PULLED - HANDBRAKE_REST) * this.pull;
      pivot.updateMatrix();
      return tip.clone().applyMatrix4(pivot.matrix); // the palm target on the moving grip
    } };
}
