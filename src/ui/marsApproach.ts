/** Shared display coordinates and continuous camera path. Distances are metres. */
import * as THREE from "three";

export const MARS_RADIUS = 3396190;
export const MARS_CENTRE = new THREE.Vector3(0, -MARS_RADIUS, 0);
export const DIVE_SECONDS = 10;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (x: number): number => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export function latLonToPoint(latDeg: number, lonDeg: number, r: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg + 180);
  return new THREE.Vector3(-r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
}

/** Align the entire tangent frame, not just its normal: east +X, north -Z. */
export function globeOrientation(lat: number, lon: number): THREE.Quaternion {
  const up = latLonToPoint(lat, lon, 1);
  const east = latLonToPoint(0, lon + 90, 1);
  const south = new THREE.Vector3().crossVectors(east, up);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, south)).invert();
}

/** Stage labels report camera scale; they never alter scene visibility. */
export function approachStage(distance: number): number {
  return distance > 140000 ? 1 : distance > 28000 ? 2 : 3;
}

/** Start at the actual orbit gaze and end at exactly the sandbox pose. */
export function approachPose(from: THREE.Vector3, to: THREE.Vector3, target: THREE.Vector3, progress: number): { position: THREE.Vector3; target: THREE.Vector3; distance: number } {
  const k = smootherstep(progress);
  const anchor = MARS_CENTRE.clone().lerp(target, smootherstep(Math.min(1, progress / 0.45)));
  const u0 = from.clone().sub(MARS_CENTRE);
  const u1 = to.clone().sub(target);
  const distance = Math.exp(THREE.MathUtils.lerp(Math.log(u0.length()), Math.log(u1.length()), k));
  // Finish geographical alignment high above the surface; tilt into the
  // final oblique view only as the regional image becomes readable.
  const dir = u0.normalize().lerp(u1.normalize(), smootherstep((progress - 0.45) / 0.55)).normalize();
  return { position: anchor.clone().addScaledVector(dir, distance), target: anchor, distance };
}

/** Cosmetic image loading and task isolation; geometry/camera stay unchanged. */
export function contextPresentation(distance: number, phase: "orbit" | "dive" | "off", lockProgress: number): { opacity: number; shade: number; blur: number } {
  const d = Math.log(Math.max(1, distance));
  if (phase === "off") return {
    opacity: 1 - smoothstep(0, 0.85, lockProgress),
    shade: 0.16 * (1 - smoothstep(0, 1, lockProgress)),
    blur: 0,
  };
  const loaded = 1 - smoothstep(Math.log(90000), Math.log(320000), d);
  const focus = 1 - smoothstep(Math.log(12000), Math.log(20000), d);
  return { opacity: 0.35 + 0.65 * loaded, shade: 1 - 0.84 * focus, blur: 5 * (1 - loaded) };
}

/** Advance the original camera path faster in orbit, preserving the final leg. */
export function approachPlaybackRate(progress: number): number {
  return 2 - smoothstep(0.45, 0.65, progress);
}

/** Blend the colourized global product toward the local warm-grey display. */
export function globeSurfaceGrade(distance: number): number {
  return 1 - smoothstep(Math.log(100000), Math.log(1500000), Math.log(Math.max(1, distance)));
}
