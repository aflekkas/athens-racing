import { Vector3 } from 'three';
import { seatPosition } from './seat-position.js';

const eye = new Vector3();
// The selected mode is the destination, not necessarily the rendered view:
// during a blend, photo or debug capture the camera can still be outside.
// Keep the shell and exterior cabin together until the camera reaches the seat.
export function syncCameraVehicleView(model, camera, mode, photo = false) {
  const cockpit = model.cockpit;
  let inside = false;
  if (mode === 'cockpit' && !photo) {
    const seat = seatPosition(model.spec.id);
    eye.copy(cockpit.eye); eye.y += seat.height; eye.z -= seat.position;
    model.body.updateWorldMatrix(true, false);
    model.body.localToWorld(eye);
    // Covers suspension/acceleration head motion, while excluding exterior views.
    inside = camera.position.distanceToSquared(eye) <= .65 * .65;
  }
  cockpit.setVisible(inside);
  return inside;
}
