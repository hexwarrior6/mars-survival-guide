/**
 * Baked display surface for the 3D sandbox.
 *
 * The published package ships a 1024² SINGLE-BAND ortho image: as an albedo it
 * gives the plate exactly one brown, and the DEM has no shading of its own
 * beyond the mesh normals. This module derives two textures once per package
 * and keeps every computed number untouched:
 *
 *  - albedo: the real ortho luminance (channel scars, dust fans) × a slope /
 *    curvature palette × long shadows baked from a horizon scan of the DEM at
 *    the app's own sun azimuth. Baking the shadows costs nothing at runtime and
 *    gives real, terrain-shaped shadows instead of a shadow map.
 *  - normalMap: the DEM plus a little multi-octave micro relief, so ridges and
 *    crater rims still read when the camera comes close.
 *
 * ARTISTIC, LABELLED: the palette, the micro relief, the haze and the tone
 * mapping are a display treatment, not measured colour or geology. The legend
 * and the sources drawer say so, and the 2D plan view keeps the raw ortho.
 * Nothing here is read back by routing, timing or resource logic.
 */

import * as THREE from "three";
import { sampleElevationM } from "../domain/world.js";
import type { TerrainGrid } from "../domain/types.js";
import type { LoadedPackage } from "../domain/load.js";

export interface TerrainLook {
  albedo: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
}

/** sun used for the bake: NW azimuth, low — matches the sandbox key light */
const SUN_ELEV_DEG = 15;
const SUN_AZIMUTH = { east: 0.732, north: 0.681 };

const ALBEDO_SIZE = 1024;
const NORMAL_SIZE = 1024;

const cache = new WeakMap<LoadedPackage, TerrainLook>();

export function getTerrainLook(pkg: LoadedPackage): TerrainLook | null {
  return cache.get(pkg) ?? null;
}

/* ------------------------------------------------------------------ */
/* deterministic noise (no Math.random: the bake must be reproducible) */
/* ------------------------------------------------------------------ */

function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ */
/* grids                                                               */
/* ------------------------------------------------------------------ */

interface Grid {
  w: number;
  h: number;
  cs: number;
  originYM: number;
}

function gridOf(t: TerrainGrid): Grid {
  return { w: t.width, h: t.height, cs: t.cellSizeM, originYM: t.originYM };
}

function gridBilinear(g: Grid, arr: Float32Array, xM: number, yM: number): number {
  const cf = Math.min(Math.max(xM / g.cs - 0.5, 0), g.w - 1);
  const rf = Math.min(Math.max((g.originYM - yM) / g.cs - 0.5, 0), g.h - 1);
  const c0 = Math.floor(cf);
  const r0 = Math.floor(rf);
  const c1 = Math.min(c0 + 1, g.w - 1);
  const r1 = Math.min(r0 + 1, g.h - 1);
  const fc = cf - c0;
  const fr = rf - r0;
  const a = arr[r0 * g.w + c0] as number;
  const b = arr[r0 * g.w + c1] as number;
  const d = arr[r1 * g.w + c0] as number;
  const e = arr[r1 * g.w + c1] as number;
  return lerp(lerp(a, b, fc), lerp(d, e, fc), fr);
}

/** long shadows: march toward the sun and keep the highest horizon angle */
function bakeSunShadows(t: TerrainGrid): Float32Array {
  const g = gridOf(t);
  const out = new Float32Array(g.w * g.h);
  const tanSun = Math.tan((SUN_ELEV_DEG * Math.PI) / 180);
  const stepCells = 4;
  const dr = -(SUN_AZIMUTH.north * stepCells);
  const dc = SUN_AZIMUTH.east * stepCells;
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const h0 = t.elevationsM[r * g.w + c] as number;
      let maxTan = -1;
      for (let k = 1; k <= 40; k++) {
        const rr = Math.round(r + dr * k);
        const cc = Math.round(c + dc * k);
        if (rr < 0 || rr >= g.h || cc < 0 || cc >= g.w) break;
        const hk = t.elevationsM[rr * g.w + cc] as number;
        const horiz = k * stepCells * g.cs;
        const tan = (hk - h0) / horiz;
        if (tan > maxTan) maxTan = tan;
      }
      out[r * g.w + c] = smoothstep(tanSun - 0.02, tanSun + 0.05, maxTan);
    }
  }
  return out;
}

/** curvature with a 60 m smoothing pass, so it reads as geology not speckle */
function bakeCurvature(t: TerrainGrid): Float32Array {
  const g = gridOf(t);
  const inv = 1 / (g.cs * g.cs);
  let src = new Float32Array(g.w * g.h);
  for (let r = 0; r < g.h; r++) {
    for (let c = 0; c < g.w; c++) {
      const r0 = Math.max(r - 1, 0);
      const r1 = Math.min(r + 1, g.h - 1);
      const c0 = Math.max(c - 1, 0);
      const c1 = Math.min(c + 1, g.w - 1);
      const h = t.elevationsM[r * g.w + c] as number;
      const lap =
        ((t.elevationsM[r0 * g.w + c] as number) +
          (t.elevationsM[r1 * g.w + c] as number) +
          (t.elevationsM[r * g.w + c0] as number) +
          (t.elevationsM[r * g.w + c1] as number) -
          4 * h) *
        inv;
      src[r * g.w + c] = Math.min(Math.max(lap * 26, -1), 1);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(src.length);
    for (let r = 0; r < g.h; r++) {
      for (let c = 0; c < g.w; c++) {
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= g.h || cc < 0 || cc >= g.w) continue;
            sum += src[rr * g.w + cc] as number;
            n++;
          }
        }
        out[r * g.w + c] = sum / n;
      }
    }
    src = out;
  }
  return src;
}

/* ------------------------------------------------------------------ */
/* textures                                                            */
/* ------------------------------------------------------------------ */

async function readOrthoLuma(size: number): Promise<Float32Array> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = "/data/jezero/imagery/ortho_5m.jpg";
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d canvas unavailable");
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const luma = new Float32Array(size * size);
  for (let i = 0; i < luma.length; i++) luma[i] = (data[i * 4] as number) / 255;
  return luma;
}

/** separable box blur, used only for the local-contrast (unsharp) term */
function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(Math.max(x + k, 0), size - 1);
        sum += src[y * size + xx] as number;
      }
      tmp[y * size + x] = sum / win;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(Math.max(y + k, 0), size - 1);
        sum += tmp[yy * size + x] as number;
      }
      out[y * size + x] = sum / win;
    }
  }
  return out;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });

export async function bakeTerrainLook(
  pkg: LoadedPackage,
  onProgress?: (fraction: number) => void,
): Promise<TerrainLook> {
  const terrain = pkg.terrain;
  const g = gridOf(terrain);
  const W = g.w * g.cs;
  const H = g.h * g.cs;

  onProgress?.(0.1);
  const shadow = bakeSunShadows(terrain);
  await nextFrame();
  onProgress?.(0.3);
  const curvature = bakeCurvature(terrain);
  const luma = await readOrthoLuma(ALBEDO_SIZE);
  // local contrast: the CTX extract is soft at 5 m/px, and ACES flattens what
  // is left. An unsharp term on the luminance restores the ridge / channel
  // structure without inventing objects.
  const lumaBlur = boxBlur(luma, ALBEDO_SIZE, 2);
  await nextFrame();

  // ---- albedo -------------------------------------------------------
  onProgress?.(0.45);
  const S = ALBEDO_SIZE;
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = S;
  albedoCanvas.height = S;
  const actx = albedoCanvas.getContext("2d");
  if (actx === null) throw new Error("2d canvas unavailable");
  const img = actx.createImageData(S, S);
  const px = img.data;

  // dusty regolith, darker rock on steep faces, pale crests, dark valley floors
  const dust = [0.80, 0.47, 0.31];
  const rock = [0.55, 0.30, 0.21];
  const crest = [0.86, 0.66, 0.49];
  const valley = [0.42, 0.22, 0.16];

  for (let j = 0; j < S; j++) {
    const yM = H - ((j + 0.5) * H) / S;
    for (let i = 0; i < S; i++) {
      const xM = ((i + 0.5) * W) / S;
      const slope = gridBilinear(g, terrain.slopeDeg, xM, yM);
      const curv = gridBilinear(g, curvature, xM, yM);
      const sh = gridBilinear(g, shadow, xM, yM);
      const raw = luma[j * S + i] as number;
      const detail = raw - (lumaBlur[j * S + i] as number);
      const lum = clamp01(raw + 0.55 * detail);

      const rockF = smoothstep(4, 27, slope);
      const crestF = smoothstep(0.02, 0.34, curv);
      const valleyF = smoothstep(0.02, 0.36, -curv);

      let r = lerp(dust[0] as number, rock[0] as number, rockF);
      let gg = lerp(dust[1] as number, rock[1] as number, rockF);
      let b = lerp(dust[2] as number, rock[2] as number, rockF);
      r = lerp(r, crest[0] as number, crestF * 0.5);
      gg = lerp(gg, crest[1] as number, crestF * 0.5);
      b = lerp(b, crest[2] as number, crestF * 0.5);
      r = lerp(r, valley[0] as number, valleyF * 0.5);
      gg = lerp(gg, valley[1] as number, valleyF * 0.5);
      b = lerp(b, valley[2] as number, valleyF * 0.5);

      const L = 0.56 + 0.95 * Math.pow(lum, 0.8);
      const grain = 0.97 + 0.06 * fbm(xM * 0.09, yM * 0.09, 2);
      const macro =
        1 + 0.07 * fbm(xM * 0.0011, yM * 0.0011, 3) + 0.05 * fbm(xM * 0.006, yM * 0.006, 2);
      const shade = 1 - 0.26 * sh;
      const k = L * grain * macro * shade;

      const o = (j * S + i) * 4;
      px[o] = clamp01(r * k) * 255;
      px[o + 1] = clamp01(gg * k) * 255;
      px[o + 2] = clamp01(b * k) * 255;
      px[o + 3] = 255;
    }
    if ((j & 127) === 127) await nextFrame();
  }
  actx.putImageData(img, 0, 0);

  // ---- normals ------------------------------------------------------
  onProgress?.(0.72);
  const N = NORMAL_SIZE;
  const bump = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const yM = H - ((j + 0.5) * H) / N;
    for (let i = 0; i < N; i++) {
      const xM = ((i + 0.5) * W) / N;
      const elev = sampleElevationM(terrain, xM, yM, 0);
      const micro = fbm(xM * 0.012, yM * 0.012, 3) * 1.1 + fbm(xM * 0.06, yM * 0.06, 2) * 0.45;
      bump[j * N + i] = elev + micro;
    }
    if ((j & 127) === 127) await nextFrame();
  }

  const normalData = new Uint8Array(N * N * 4);
  const dx = W / N;
  for (let j = 0; j < N; j++) {
    const jN = Math.max(j - 1, 0);
    const jS = Math.min(j + 1, N - 1);
    for (let i = 0; i < N; i++) {
      const iL = Math.max(i - 1, 0);
      const iR = Math.min(i + 1, N - 1);
      const dhdx = ((bump[j * N + iR] as number) - (bump[j * N + iL] as number)) / ((iR - iL) * dx);
      // row index grows southward, tangent +V points north
      const dhdy = ((bump[jN * N + i] as number) - (bump[jS * N + i] as number)) / ((jS - jN) * dx);
      let nx = -dhdx;
      let ny = -dhdy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (j * N + i) * 4;
      normalData[o] = (nx * 0.5 + 0.5) * 255;
      normalData[o + 1] = (ny * 0.5 + 0.5) * 255;
      normalData[o + 2] = (nz * 0.5 + 0.5) * 255;
      normalData[o + 3] = 255;
    }
    if ((j & 255) === 255) await nextFrame();
  }

  const normalMap = new THREE.DataTexture(normalData, N, N, THREE.RGBAFormat);
  normalMap.wrapS = THREE.ClampToEdgeWrapping;
  normalMap.wrapT = THREE.ClampToEdgeWrapping;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.generateMipmaps = true;
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.ClampToEdgeWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.anisotropy = 8;

  onProgress?.(1);
  const look: TerrainLook = { albedo, normalMap };
  cache.set(pkg, look);
  return look;
}
