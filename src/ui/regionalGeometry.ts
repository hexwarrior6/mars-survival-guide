/** Fixed regional surround with an exact opening for the local DEM.
 * Outside the measured package, a display-only apron joins the DEM boundary
 * to Mars curvature. It is not a regional elevation measurement.
 */
import * as THREE from "three";
import type { TerrainGrid } from "../domain/types.js";
import { sampleElevationM, worldTransform, worldY, type WorldTransform } from "../domain/world.js";
import { MARS_RADIUS, smootherstep } from "./marsApproach.js";

export const REGIONAL_SIZE = 60000;
export const REGIONAL_CENTRE_X = 6100;

export function regionalHeight(terrain: TerrainGrid, x: number, z: number, t: WorldTransform = worldTransform(terrain)): number {
  const edgeX = t.halfWidthM - terrain.cellSizeM / 2;
  const edgeZ = t.halfHeightM - terrain.cellSizeM / 2;
  const cx = THREE.MathUtils.clamp(x, -edgeX, edgeX);
  const cz = THREE.MathUtils.clamp(z, -edgeZ, edgeZ);
  const boundary = worldY(t, sampleElevationM(terrain, cx + t.halfWidthM, t.halfHeightM - cz, t.datumM));
  const curvature = Math.sqrt(MARS_RADIUS ** 2 - x * x - z * z) - MARS_RADIUS;
  return THREE.MathUtils.lerp(boundary, curvature, smootherstep(Math.hypot(x - cx, z - cz) / 3000));
}

export function regionalGeometry(terrain: TerrainGrid): THREE.BufferGeometry {
  const t = worldTransform(terrain);
  const hx = t.halfWidthM - terrain.cellSizeM / 2;
  const hz = t.halfHeightM - terrain.cellSizeM / 2;
  const left = REGIONAL_CENTRE_X - REGIONAL_SIZE / 2;
  const right = REGIONAL_CENTRE_X + REGIONAL_SIZE / 2;
  const half = REGIONAL_SIZE / 2;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  // Four rectangles leave the precise measured DEM footprint open. The two
  // vertical strips sample every DEM row along their shared seam, as do the
  // horizontal strips along every DEM column: no overlapping map or T-junction.
  const axis = (a: number, b: number, step: number): number[] => {
    const n = Math.ceil((b - a) / step);
    return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  };
  const patch = (xs: number[], zs: number[]): void => {
    const offset = positions.length / 3;
    for (const z of zs) for (const x of xs) {
      positions.push(x, regionalHeight(terrain, x, z, t), z);
      uvs.push((x - left) / REGIONAL_SIZE, (half - z) / REGIONAL_SIZE);
    }
    for (let r = 0; r < zs.length - 1; r++) for (let c = 0; c < xs.length - 1; c++) {
      const a = offset + r * xs.length + c, b = a + 1, d = a + xs.length, e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  };
  const centreX = axis(-hx, hx, terrain.cellSizeM);
  const centreZ = axis(-hz, hz, terrain.cellSizeM);
  const allZ = [...axis(-half, -hz, 500).slice(0, -1), ...centreZ, ...axis(hz, half, 500).slice(1)];
  patch(axis(left, -hx, 500), allZ);
  patch(axis(hx, right, 500), allZ);
  patch(centreX, axis(-half, -hz, 500));
  patch(centreX, axis(hz, half, 500));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
