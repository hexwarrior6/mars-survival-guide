/** Tiny command bus between the UI panels and the in-canvas camera director.
 * The UI commands a pose; the director eases the camera there (or jumps for the
 * reduced-motion preference). User dragging cancels any running transition —
 * this doubles as the "skip intro" gesture for the opening move, and it also
 * discards a pending follow-up move (then) so a user who grabs the camera is
 * never yanked away by the second leg of a two-stage fly. */

import type { CameraPose } from "../domain/world.js";

export interface CameraFollowUp {
  pose: CameraPose;
  durationMs?: number;
}

export interface CameraCommand {
  seq: number;
  pose: CameraPose;
  instant: boolean;
  /** transition duration in ms; omitted = the director's default ease */
  durationMs?: number;
  /** optional second leg, flown automatically once this transition completes
   * (skipped when the user grabs the camera mid-transition) */
  then?: CameraFollowUp;
}

const ref: { current: CameraCommand | null } = { current: null };
let seq = 0;

export function commandCamera(
  pose: CameraPose,
  instant = false,
  durationMs?: number,
  then?: CameraFollowUp,
): void {
  seq++;
  ref.current = { seq, pose, instant, durationMs, then };
}

export function readCameraCommand(): CameraCommand | null {
  return ref.current;
}

export function cameraSeq(): number {
  return seq;
}
