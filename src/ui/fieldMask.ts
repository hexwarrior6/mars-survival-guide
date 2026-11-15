/** Returnable-range field as a terrain-sized texture of walk-minutes.
 *
 * Two problems with the old overlay drove this: 60k flat 20 m quads laid on the
 * plate intersect it at the current relief (they read as a hatch), and the
 * whole 65k-cell geometry was rebuilt on every scrub tick. The field is a
 * property of the ground, so the terrain material samples it by UV instead —
 * one fetch per fragment, no geometry, no z-fighting, and it follows every
 * slope exactly.
 *
 * The texture stores normalised walk-minutes (0..1 over `MAX_MINUTES`), not a
 * binary mask, so the shader can draw a smooth region tint *and* a smooth
 * contour from the same fetch. Only the field changes need an upload; the
 * threshold is a uniform.
 */

import * as THREE from "three";
import type { TerrainGrid } from "../domain/types.js";
import type { CostField } from "../routing/field.js";

/** minutes represented by the full range of the texture */
export const FIELD_MAX_MINUTES = 400;

export function createFieldTexture(terrain: TerrainGrid): THREE.DataTexture {
  const w = terrain.width;
  const h = terrain.height;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 255; // "unreachable" until the first upload
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  // rows are stored north-up to match the terrain UVs (v = 1 - (r+0.5)/h)
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** rewrite the field texture; cheap (64k bytes) and only needed on field change */
export function updateFieldTexture(
  tex: THREE.DataTexture,
  terrain: TerrainGrid,
  field: CostField,
): void {
  const w = terrain.width;
  const h = terrain.height;
  const data = tex.image.data as Uint8Array;
  for (let r = 0; r < h; r++) {
    const row = (h - 1 - r) * w;
    for (let c = 0; c < w; c++) {
      const minutes = field.minutes[r * w + c] as number;
      const norm = Number.isFinite(minutes)
        ? Math.max(0, Math.min(1, minutes / FIELD_MAX_MINUTES))
        : 1;
      const i = (row + c) * 4;
      const v = Math.round(norm * 255);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  tex.needsUpdate = true;
}
