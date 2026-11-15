/** Cut-away block around the terrain plate.
 *
 * Purely a display layer: four side faces extruded from the DEM edge down to a
 * slab, with a procedural strata texture, so the sandbox reads as a physical
 * model instead of a photograph on a floating sheet. The strata pattern, the
 * cut depth and the lit rim are ARTISTIC and labelled as such in the legend and
 * the sources drawer — they are not measured stratigraphy, and nothing here
 * feeds any computation. Geometry anchors (x/z and the top edge) are the real
 * DEM cells, so the block can never drift away from the data.
 */

import { useMemo } from "react";
import type { JSX } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { TerrainGrid } from "../domain/types.js";
import {
  cellWorldPosition,
  worldY,
  type WorldTransform,
} from "../domain/world.js";

/** how far below the lowest terrain point the block is cut (world units) */
const CUT_DEPTH_WORLD = 300;
/** world metres per strata texture tile (keeps band thickness constant) */
const STRATA_TILE_WORLD = 260;

function makeStrataTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const bands: Array<[string, string]> = [
    ["#241310", "#2e1a15"],
    ["#3f2419", "#4b2c1f"],
    ["#65392a", "#744534"],
    ["#8a5539", "#9a6143"],
    ["#a87350", "#b78259"],
    ["#331d17", "#3d241d"],
  ];
  if (ctx !== null) {
    let seed = 20261115;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967295;
    };
    let y = 0;
    while (y < 1024) {
      const h = 7 + Math.floor(rnd() * 44);
      const pair = bands[Math.floor(rnd() * bands.length)] ?? (bands[0] as [string, string]);
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, pair[0]);
      grad.addColorStop(1, pair[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, 64, h);
      if (rnd() > 0.84) {
        ctx.fillStyle = "rgba(255, 226, 190, 0.14)";
        ctx.fillRect(0, y + h - 1, 64, 1);
      }
      y += h;
    }
    // vertical grime streaks + a darker base so the cut face sits in shadow
    for (let i = 0; i < 240; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.07})`;
      ctx.fillRect(
        Math.floor(rnd() * 64),
        Math.floor(rnd() * 1024),
        1 + Math.floor(rnd() * 3),
        8 + Math.floor(rnd() * 90),
      );
    }
    const shade = ctx.createLinearGradient(0, 0, 0, 1024);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(0.72, "rgba(0,0,0,0.18)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 64, 1024);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** clock-wise perimeter as [row, col] pairs along the grid border */
function perimeterCells(terrain: TerrainGrid): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const w = terrain.width;
  const h = terrain.height;
  for (let c = 0; c < w; c++) out.push([0, c]);
  for (let r = 1; r < h; r++) out.push([r, w - 1]);
  for (let c = w - 2; c >= 0; c--) out.push([h - 1, c]);
  for (let r = h - 2; r >= 1; r--) out.push([r, 0]);
  return out;
}

export function BlockSides({
  terrain,
  t,
}: {
  terrain: TerrainGrid;
  t: WorldTransform;
}): JSX.Element | null {
  const built = useMemo(() => {
    const cells = perimeterCells(terrain);
    if (cells.length < 3) return null;

    // vertical extent of the real terrain (world units, relief scale applied)
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < terrain.elevationsM.length; i++) {
      if ((terrain.validMask[i] as number) !== 1) continue;
      const y = worldY(t, terrain.elevationsM[i] as number);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minY)) return null;
    const baseY = minY - CUT_DEPTH_WORLD;
    const span = Math.max(maxY - baseY, 1);

    const positions: number[] = [];
    const uvs: number[] = [];
    const top: THREE.Vector3[] = [];
    let distance = 0;

    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i] as [number, number];
      const p = cellWorldPosition(terrain, t, r, c, 0);
      top.push(new THREE.Vector3(p.x, p.y, p.z));
      if (i === 0) continue;
      const prev = top[i - 1] as THREE.Vector3;
      const cur = top[i] as THREE.Vector3;
      const seg = Math.hypot(cur.x - prev.x, cur.z - prev.z);
      const u0 = distance / STRATA_TILE_WORLD;
      const u1 = (distance + seg) / STRATA_TILE_WORLD;
      distance += seg;
      const vTop = (y: number): number => (y - baseY) / span;
      // quad: prevTop -> prevBase -> curTop, then curTop -> prevBase -> curBase
      positions.push(
        prev.x, prev.y, prev.z,
        prev.x, baseY, prev.z,
        cur.x, cur.y, cur.z,
        cur.x, cur.y, cur.z,
        prev.x, baseY, prev.z,
        cur.x, baseY, cur.z,
      );
      uvs.push(
        u0, vTop(prev.y),
        u0, vTop(baseY),
        u1, vTop(cur.y),
        u1, vTop(cur.y),
        u0, vTop(baseY),
        u1, vTop(baseY),
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      map: makeStrataTexture(),
      color: "#e2c8b0",
      roughness: 0.94,
      metalness: 0.02,
      // a touch of self-illumination keeps the cut face readable when it faces
      // away from the key light (display only, no effect on the terrain)
      emissive: new THREE.Color("#1d0f09"),
      emissiveIntensity: 1,
      side: THREE.DoubleSide,
    });

    // close the bottom so the block reads as a solid object from low angles
    const floorGeo = new THREE.PlaneGeometry(
      terrain.width * terrain.cellSizeM,
      terrain.height * terrain.cellSizeM,
    );
    floorGeo.rotateX(-Math.PI / 2);

    return { geo, material, top, baseY, floorGeo };
  }, [terrain, t]);

  if (built === null) return null;
  const { geo, material, top, baseY, floorGeo } = built;
  return (
    <group name="block-sides">
      <mesh geometry={geo} material={material} name="block-faces" />
      <mesh
        geometry={floorGeo}
        position={[0, baseY, 0]}
        name="block-floor"
      >
        <meshStandardMaterial color="#100a07" roughness={1} metalness={0} />
      </mesh>
      {/* lit lip along the cut edge: separates the block from the background */}
      <Line
        points={top}
        color="#ffcf9f"
        lineWidth={1.1}
        transparent
        opacity={0.2}
        depthWrite={false}
      />
    </group>
  );
}
