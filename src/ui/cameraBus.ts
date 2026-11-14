/** Tiny command bus between the UI panels and the in-canvas camera director.
 * The UI commands a pose; the director eases the camera there (or jumps for the
 * reduced-motion preference). User dragging cancels any running transition. */

import type { CameraPose } from "../domain/world.js";

export interface CameraCommand {
  seq: number;
  pose: CameraPose;
  instant: boolean;
}

const ref: { current: CameraCommand | null } = { current: null };
let seq = 0;

export function commandCamera(pose: CameraPose, instant = false): void {
  seq++;
  ref.current = { seq, pose, instant };
}

export function readCameraCommand(): CameraCommand | null {
  return ref.current;
}

export function cameraSeq(): number {
  return seq;
}
