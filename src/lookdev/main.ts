/**
 * Terrain look development for the next visual pass on the 3D sandbox.
 *
 * NOT the app. This page renders the SAME NASA data package (CTX DEM 20 m +
 * CTX ortho) through a proposed display treatment so the direction can be
 * judged and recorded before src/ui/Sandbox.tsx is touched:
 *
 *  - a cut-away terrain block with strata faces (reads as a physical model)
 *  - derived albedo (real ortho luminance x slope/curvature palette) + baked
 *    long shadows from a horizon scan of the DEM (sun azimuth NW, as the app)
 *  - micro-relief normal detail near the camera (artistic, labelled)
 *  - dust, ground haze, bloom, ACES tone mapping
 *  - three camera shots including a helmet cam that follows the REAL planned
 *    route from the routing kernel
 *
 * Every artistic element is called out in the corner label. Real geometry,
 * real route, documented vertical exaggeration.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { loadPackageFromFetch } from "../data/fetchLoader.js";
import { planRoundTrip } from "../routing/plan.js";
import { PARAMS_VERSION } from "../domain/assumptions.js";
import {
  cellWorldPosition,
  sampleElevationM,
  worldTransform,
  worldXZ,
  worldY,
  type WorldTransform,
} from "../domain/world.js";
import type { TerrainGrid } from "../domain/types.js";
import type { LoadedPackage } from "../domain/load.js";

type Mode = "overview" | "low" | "helmet" | "tour";

const RELIEF = 3; // same documented display exaggeration as src/domain/world.ts
/** extra display exaggeration on top of the app's x3 (URL: ?v=4.5) */
const VSCALE = (() => {
  const raw = new URLSearchParams(location.search).get("v");
  const v = raw === null ? 3 : Number(raw);
  return Number.isFinite(v) && v >= 1 && v <= 8 ? v : 3;
})();
const VK = VSCALE / RELIEF;
const DATA = "/data/jezero";
const SKY_RADIUS = 26000;

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** deterministic hash noise in [-1, 1] */
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
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
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

interface GridInfo {
  w: number;
  h: number;
  cs: number;
  originYM: number;
}
function gridInfo(t: TerrainGrid): GridInfo {
  return { w: t.width, h: t.height, cs: t.cellSizeM, originYM: t.originYM };
}
function gridBilinear(g: GridInfo, arr: Float32Array, xM: number, yM: number): number {
  const cf = clamp(xM / g.cs - 0.5, 0, g.w - 1);
  const rf = clamp((g.originYM - yM) / g.cs - 0.5, 0, g.h - 1);
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

/* ------------------------------------------------------------------ */
/* baked terrain terms: long shadows + curvature (both from the DEM)   */
/* ------------------------------------------------------------------ */

/** Sun as used by the app's key light: NW azimuth, low-ish elevation. */
const SUN_ELEV_DEG = 17;
const SUN_AZIMUTH = { east: 0.732, north: 0.681 }; // toward the sun, normalized

function bakeSunShadows(t: TerrainGrid): Float32Array {
  const g = gridInfo(t);
  const out = new Float32Array(g.w * g.h);
  const tanSun = Math.tan((SUN_ELEV_DEG * Math.PI) / 180);
  const stepCells = 4; // 80 m per march step
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
        maxTan = Math.max(maxTan, (hk - h0) / horiz);
      }
      out[r * g.w + c] = smoothstep(tanSun - 0.02, tanSun + 0.05, maxTan); // 1 = shadowed
    }
  }
  return out;
}

function blurGrid(t: TerrainGrid, src: Float32Array, passes: number): Float32Array {
  const g = gridInfo(t);
  let a = src;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(a.length);
    for (let r = 0; r < g.h; r++) {
      for (let c = 0; c < g.w; c++) {
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= g.h || cc < 0 || cc >= g.w) continue;
            sum += a[rr * g.w + cc] as number;
            n++;
          }
        }
        out[r * g.w + c] = sum / n;
      }
    }
    a = out;
  }
  return a;
}

function bakeCurvature(t: TerrainGrid): Float32Array {
  const g = gridInfo(t);
  const out = new Float32Array(g.w * g.h);
  const inv = 1 / (g.cs * g.cs);
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
      out[r * g.w + c] = clamp(lap * 26, -1, 1);
    }
  }
  return blurGrid(t, out, 2); // 60 m smoothing: geology, not speckle
}

/* ------------------------------------------------------------------ */
/* textures                                                            */
/* ------------------------------------------------------------------ */

async function loadOrthoLuma(size: number): Promise<Float32Array> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = `${DATA}/imagery/ortho_5m.jpg`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(img, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size).data;
  const luma = new Float32Array(size * size);
  for (let i = 0; i < luma.length; i++) luma[i] = (d[i * 4] as number) / 255;
  return luma;
}

interface TerrainTextures {
  albedo: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
}

function buildTerrainTextures(
  pkg: LoadedPackage,
  t: WorldTransform,
  luma: Float32Array,
  shadow: Float32Array,
  curvature: Float32Array,
): TerrainTextures {
  const terrain = pkg.terrain;
  const g = gridInfo(terrain);
  const W = g.w * g.cs;
  const H = g.h * g.cs;
  const S = 1024;
  const datum = t.datumM;

  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = S;
  albedoCanvas.height = S;
  const actx = albedoCanvas.getContext("2d");
  if (!actx) throw new Error("2d context unavailable");
  const albedoImg = actx.createImageData(S, S);

  const bump = new Float32Array(S * S);
  const al = albedoImg.data;

  // palette (sRGB 0..1): dusty regolith, darker rock on slopes, pale crests
  const dust: [number, number, number] = [0.80, 0.47, 0.31];
  const rock: [number, number, number] = [0.55, 0.30, 0.21];
  const crest: [number, number, number] = [0.86, 0.66, 0.49];
  const valley: [number, number, number] = [0.42, 0.22, 0.16];

  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const xM = ((i + 0.5) * W) / S;
      const yM = H - ((j + 0.5) * H) / S;
      const elev = sampleElevationM(terrain, xM, yM, datum);
      const micro = fbm(xM * 0.012, yM * 0.012, 3) * 1.1 + fbm(xM * 0.06, yM * 0.06, 2) * 0.45;
      bump[j * S + i] = (elev - datum) * RELIEF + micro;

      const slope = gridBilinear(g, terrain.slopeDeg, xM, yM);
      const curv = gridBilinear(g, curvature, xM, yM);
      const sh = gridBilinear(g, shadow, xM, yM);
      const lum = luma[j * S + i] as number;

      const rockF = smoothstep(4, 27, slope);
      const crestF = smoothstep(0.02, 0.34, curv);
      const valleyF = smoothstep(0.02, 0.36, -curv);

      let r = lerp(dust[0], rock[0], rockF);
      let gg = lerp(dust[1], rock[1], rockF);
      let b = lerp(dust[2], rock[2], rockF);
      r = lerp(r, crest[0], crestF * 0.5);
      gg = lerp(gg, crest[1], crestF * 0.5);
      b = lerp(b, crest[2], crestF * 0.5);
      r = lerp(r, valley[0], valleyF * 0.7);
      gg = lerp(gg, valley[1], valleyF * 0.7);
      b = lerp(b, valley[2], valleyF * 0.7);

      // keep the real CTX albedo detail (channel scars, dust fans) as luminance
      const L = 0.52 + 0.9 * Math.pow(lum, 0.8);
      const grain = 0.97 + 0.06 * fbm(xM * 0.09, yM * 0.09, 2);
      // broad geological units (hundreds of metres), not per-cell noise
      const macro = 1 + 0.07 * fbm(xM * 0.0011, yM * 0.0011, 3);
      const shade = 1 - 0.34 * sh;
      const k = L * grain * macro * shade;
      const o = (j * S + i) * 4;
      al[o] = clamp(r * k, 0, 1) * 255;
      al[o + 1] = clamp(gg * k, 0, 1) * 255;
      al[o + 2] = clamp(b * k, 0, 1) * 255;
      al[o + 3] = 255;
    }
  }
  actx.putImageData(albedoImg, 0, 0);

  // normals from the bump field (DEM + artistic micro-relief), 5 m/px
  const normalData = new Uint8Array(S * S * 4);
  const dx = W / S;
  const strength = 1.0;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const iL = Math.max(i - 1, 0);
      const iR = Math.min(i + 1, S - 1);
      const jN = Math.max(j - 1, 0);
      const jS = Math.min(j + 1, S - 1);
      const dhdx = ((bump[j * S + iR] as number) - (bump[j * S + iL] as number)) / ((iR - iL) * dx);
      // row index grows southward, tangent +V points north
      const dhdy = ((bump[jN * S + i] as number) - (bump[jS * S + i] as number)) / ((jS - jN) * dx);
      let nx = -dhdx * strength;
      let ny = -dhdy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (j * S + i) * 4;
      normalData[o] = (nx * 0.5 + 0.5) * 255;
      normalData[o + 1] = (ny * 0.5 + 0.5) * 255;
      normalData[o + 2] = (nz * 0.5 + 0.5) * 255;
      normalData[o + 3] = 255;
    }
  }
  const normalMap = new THREE.DataTexture(normalData, S, S, THREE.RGBAFormat);
  normalMap.wrapS = THREE.ClampToEdgeWrapping;
  normalMap.wrapT = THREE.ClampToEdgeWrapping;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.generateMipmaps = true;
  normalMap.anisotropy = 8;
  normalMap.needsUpdate = true;

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.ClampToEdgeWrapping;
  albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.anisotropy = 8;

  return { albedo, normalMap };
}

/** Vertical strata for the cut faces of the block. Artistic, labelled. */
function buildStrataTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 1024;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  let seed = 20261115;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967295;
  };
  const bands: Array<[string, string]> = [
    ["#33201a", "#3f2a20"],
    ["#5c3527", "#6b3f2d"],
    ["#8a5238", "#9c6042"],
    ["#b07650", "#c4875c"],
    ["#d9a071", "#e6b184"],
    ["#4a2c22", "#57342a"],
  ];
  let y = 0;
  while (y < 1024) {
    const hBand = 6 + Math.floor(rnd() * 42);
    const pair = bands[Math.floor(rnd() * bands.length)] ?? (bands[0] as [string, string]);
    const grad = ctx.createLinearGradient(0, y, 0, y + hBand);
    grad.addColorStop(0, pair[0] as string);
    grad.addColorStop(1, pair[1] as string);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, 64, hBand);
    if (rnd() > 0.82) {
      ctx.fillStyle = "rgba(255, 226, 190, 0.18)";
      ctx.fillRect(0, y + hBand - 1, 64, 1);
    }
    y += hBand;
  }
  // grime + vertical streaks
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.08})`;
    ctx.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 1024), 1 + Math.floor(rnd() * 3), 8 + Math.floor(rnd() * 90));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ */
/* geometry                                                            */
/* ------------------------------------------------------------------ */

function buildTerrain(pkg: LoadedPackage, t: WorldTransform, tex: TerrainTextures): THREE.Mesh {
  const terrain = pkg.terrain;
  const w = terrain.width;
  const h = terrain.height;
  const positions = new Float32Array(w * h * 3);
  const uvs = new Float32Array(w * h * 2);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const p = cellWorldPosition(terrain, t, r, c, 0);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y * VK;
      positions[i * 3 + 2] = p.z;
      // image row 0 = north = v 1
      uvs[i * 2] = (c + 0.5) / w;
      uvs[i * 2 + 1] = 1 - (r + 0.5) / h;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const a = r * w + c;
      const b = a + 1;
      const d = (r + 1) * w + c;
      const e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    map: tex.albedo,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 1,
    metalness: 0,
    dithering: true,
  });
  // near-field granularity: the CTX ortho is only 5 m/px, so at close range the
  // surface needs an artistic detail layer (labelled as artistic in the corner)
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWPos;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWPos;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float n2(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
                     mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float grain(vec2 p){ return n2(p * 0.9) * 0.5 + n2(p * 2.7) * 0.3 + n2(p * 7.1) * 0.2; }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float dA = grain(vWPos.xz * 0.32);
        float dB = grain(vWPos.xz * 1.8 + 17.0);
        float detail = mix(dA, dB, 0.55);
        diffuseColor.rgb *= 0.78 + 0.46 * detail;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 0.96, 0.88), detail * 0.65);`,
      );
  };
  mat.customProgramCacheKey = () => "terrain-detail-v1";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  return mesh;
}

/** Extruded block sides: turns the plate into an object. Strata = artistic. */
function buildBlockSides(pkg: LoadedPackage, t: WorldTransform, strata: THREE.Texture): THREE.Group {
  const terrain = pkg.terrain;
  const g = gridInfo(terrain);
  const positions: number[] = [];
  const uvs: number[] = [];
  let bottomY = Infinity;
  let topMax = -Infinity;
  for (let i = 0; i < terrain.elevationsM.length; i++) {
    if ((terrain.validMask[i] as number) !== 1) continue;
    const y = worldY(t, terrain.elevationsM[i] as number) * VK;
    bottomY = Math.min(bottomY, y);
    topMax = Math.max(topMax, y);
  }
  const baseY = bottomY - 300;
  const perimeter: Array<[number, number]> = [];
  for (let c = 0; c < g.w; c++) perimeter.push([0, c]);
  for (let r = 1; r < g.h; r++) perimeter.push([r, g.w - 1]);
  for (let c = g.w - 2; c >= 0; c--) perimeter.push([g.h - 1, c]);
  for (let r = g.h - 2; r >= 1; r--) perimeter.push([r, 0]);

  let dist = 0;
  for (let i = 0; i < perimeter.length - 1; i++) {
    const a = perimeter[i] as [number, number];
    const b = perimeter[i + 1] as [number, number];
    const pa0 = cellWorldPosition(terrain, t, a[0], a[1], 0);
    const pb0 = cellWorldPosition(terrain, t, b[0], b[1], 0);
    const pa = { x: pa0.x, y: pa0.y * VK, z: pa0.z };
    const pb = { x: pb0.x, y: pb0.y * VK, z: pb0.z };
    const seg = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const u0 = dist / 260;
    const u1 = (dist + seg) / 260;
    dist += seg;
    const v = (y: number): number => (y - baseY) / (topMax - baseY + 1);
    // two triangles, CCW seen from outside; material is double-sided anyway
    positions.push(pa.x, pa.y, pa.z, pa.x, baseY, pa.z, pb.x, pb.y, pb.z);
    uvs.push(u0, v(pa.y), u0, v(baseY), u1, v(pb.y));
    positions.push(pb.x, pb.y, pb.z, pa.x, baseY, pa.z, pb.x, baseY, pb.z);
    uvs.push(u1, v(pb.y), u0, v(baseY), u1, v(baseY));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();

  const sideMat = new THREE.MeshStandardMaterial({
    map: strata,
    roughness: 0.92,
    metalness: 0.02,
    side: THREE.DoubleSide,
    color: new THREE.Color("#c4a189"),
  });
  const sides = new THREE.Mesh(geo, sideMat);

  const floorGeo = new THREE.PlaneGeometry(g.w * g.cs, g.h * g.cs);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: "#120a07", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = baseY;

  const lipPts: THREE.Vector3[] = [];
  for (const [r, c] of perimeter) {
    const p = cellWorldPosition(terrain, t, r, c, 0);
    lipPts.push(new THREE.Vector3(p.x, p.y * VK + 1.2, p.z));
  }
  const lipGeo = new THREE.BufferGeometry().setFromPoints(lipPts);
  const lip = new THREE.Line(
    lipGeo,
    new THREE.LineBasicMaterial({ color: "#ffcfa2", transparent: true, opacity: 0.35 }),
  );

  const group = new THREE.Group();
  group.name = "block";
  group.add(sides, floor, lip);
  return group;
}

/* ------------------------------------------------------------------ */
/* route ribbon (terrain-hugging, additive glow)                       */
/* ------------------------------------------------------------------ */

function buildRouteRibbon(
  pkg: LoadedPackage,
  t: WorldTransform,
  pts: THREE.Vector3[],
  color: THREE.Color,
): THREE.Mesh | null {
  if (pts.length < 2) return null;
  const halfW = 5.5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as THREE.Vector3;
    const prev = pts[Math.max(i - 1, 0)] as THREE.Vector3;
    const next = pts[Math.min(i + 1, pts.length - 1)] as THREE.Vector3;
    const tx = next.x - prev.x;
    const tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    const lx = (-tz / tl) * halfW;
    const lz = (tx / tl) * halfW;
    if (i > 0) {
      const q = pts[i - 1] as THREE.Vector3;
      dist += Math.hypot(p.x - q.x, p.z - q.z);
    }
    for (const s of [-1, 1]) {
      const x = p.x + lx * s;
      const z = p.z + lz * s;
      const elev = sampleElevationM(
        pkg.terrain,
        x + t.halfWidthM,
        t.halfHeightM - z,
        t.datumM,
      );
      positions.push(x, worldY(t, elev) * VK + 2.6, z);
      uvs.push(s < 0 ? 0 : 1, dist / 46);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uTime;
      void main() {
        float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float core = pow(edge, 7.0) * 1.5 + pow(edge, 1.6) * 0.20;
        // travelling energy pulse along the path
        float pulse = smoothstep(0.86, 1.0, sin(vUv.y * 0.55 - uTime * 2.2) * 0.5 + 0.5);
        float energy = clamp(core + pulse * pow(edge, 2.0) * 0.55, 0.0, 1.8);
        vec3 lit = mix(uColor * 1.6, vec3(1.0), clamp(energy - 0.35, 0.0, 1.0));
        gl_FragColor = vec4(lit, clamp(pow(edge, 1.4) * 0.95 + pulse * 0.25, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "route-ribbon";
  mesh.renderOrder = 3;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* props: habitat, astronaut, beacons, dust                            */
/* ------------------------------------------------------------------ */

function softDotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,244,228,1)");
  g.addColorStop(0.25, "rgba(255,214,170,0.55)");
  g.addColorStop(1, "rgba(255,180,110,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildBase(pkg: LoadedPackage, t: WorldTransform): THREE.Group {
  const b = pkg.scenario.base;
  const p = cellWorldPosition(pkg.terrain, t, b.rowCol[0], b.rowCol[1], 0);
  const group = new THREE.Group();
  group.position.set(p.x, p.y * VK, p.z);

  const shell = new THREE.MeshStandardMaterial({ color: "#efe7d8", roughness: 0.55, metalness: 0.12 });
  const dark = new THREE.MeshStandardMaterial({ color: "#8d8579", roughness: 0.7, metalness: 0.2 });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(22, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  dome.position.y = 2;
  group.add(dome);

  const module1 = new THREE.Mesh(new THREE.BoxGeometry(26, 10, 15), shell);
  module1.position.set(30, 5, 8);
  group.add(module1);

  const module2 = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), dark);
  module2.position.set(16, 3, -18);
  group.add(module2);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 22, 8), dark);
  mast.position.set(-8, 11, -6);
  group.add(mast);

  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 12, 10),
    new THREE.MeshBasicMaterial({ color: "#ffd9a0" }),
  );
  lamp.position.set(30, 10.5, 8);
  group.add(lamp);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: "#ffbe78",
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    }),
  );
  glow.position.copy(lamp.position);
  glow.scale.setScalar(46);
  group.add(glow);

  // scale figure beside the habitat (1.7 m, true scale like the app)
  const suit = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.45, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.0, 4, 12), suit);
  body.position.set(-26, 0.85, 14);
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshStandardMaterial({ color: "#d8d2c6", roughness: 0.3, metalness: 0.35 }));
  head.position.set(-26, 1.74, 14);
  group.add(head);

  const plinthLight = new THREE.PointLight("#ffb066", 900, 260, 2);
  plinthLight.position.set(24, 16, 6);
  group.add(plinthLight);

  return group;
}

/** Instanced boulders: artistic detail for close views (labelled). */
function buildRocks(pkg: LoadedPackage, t: WorldTransform, route: THREE.Vector3[]): THREE.InstancedMesh {
  const terrain = pkg.terrain;
  const count = 1800;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // squash + jitter so instances do not read as identical spheres
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) as number;
    const y = pos.getY(i) as number;
    const z = pos.getZ(i) as number;
    const j = 0.82 + 0.36 * Math.abs(valueNoise(x * 2.1 + z * 1.7, y * 2.3));
    pos.setXYZ(i, x * j, y * 0.68 * j, z * j);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, flatShading: true, vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "rocks";
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const halfW = t.halfWidthM;
  const halfH = t.halfHeightM;
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    if (route.length > 0 && Math.random() < 0.7) {
      const p = route[Math.floor(Math.random() * route.length)] as THREE.Vector3;
      const r = 20 + Math.random() * 190;
      const a = Math.random() * Math.PI * 2;
      x = p.x + Math.cos(a) * r;
      z = p.z + Math.sin(a) * r;
    } else {
      x = (Math.random() - 0.5) * halfW * 1.96;
      z = (Math.random() - 0.5) * halfH * 1.96;
    }
    const elev = sampleElevationM(terrain, x + halfW, halfH - z, t.datumM);
    const s = 1.2 + Math.pow(Math.random(), 2.4) * 9;
    dummy.position.set(x, worldY(t, elev) * VK + s * 0.32, z);
    dummy.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, Math.random() * 0.6);
    dummy.scale.set(s, s * (0.55 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.6));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    const shade = 0.32 + Math.random() * 0.4;
    color.setRGB(shade * 1.05, shade * 0.62, shade * 0.46);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function buildDust(): THREE.Points {
  const count = 1400;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 6200;
    pos[i * 3 + 1] = Math.random() * 420 - 40;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 6200;
    seed[i] = Math.random();
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.PointsMaterial({
    size: 9,
    map: softDotTexture(),
    color: new THREE.Color("#ffc38f"),
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(g, mat);
  points.name = "dust";
  points.frustumCulled = false;
  return points;
}

function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 48, 32);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sunDir.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSun;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 zenith = vec3(0.006, 0.004, 0.003);
        vec3 horizon = vec3(0.085, 0.033, 0.016);
        vec3 col = mix(horizon, zenith, smoothstep(-0.01, 0.14, h));
        float sun = pow(max(dot(vDir, normalize(uSun)), 0.0), 90.0);
        col += vec3(1.0, 0.52, 0.22) * sun * 0.13;
        col = mix(col * 0.10, col, smoothstep(-0.30, 0.0, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sky";
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const stage = document.getElementById("stage");
const loading = document.getElementById("loading");
const loadmsg = document.getElementById("loadmsg");
const suit = document.getElementById("suit");
if (!stage || !loading || !loadmsg || !suit) throw new Error("missing DOM");
const loadingEl = loading;
const loadmsgEl = loadmsg;
const suitEl = suit;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#070504");
scene.fog = new THREE.FogExp2("#1a0e08", 0.000045);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 2, 60000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 300;
controls.maxDistance = 24000;
controls.enablePan = false;
controls.target.set(0, 120, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.34,
  0.5,
  0.9,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// sun: NW azimuth (same as the app / DEM hillshade convention), low for drama
const sunDir = new THREE.Vector3(-0.72, Math.sin((SUN_ELEV_DEG * Math.PI) / 180), -0.66).normalize();

let routeCurve: THREE.CatmullRomCurve3 | null = null;
let routeRibbonMat: THREE.ShaderMaterial | null = null;

async function init(): Promise<void> {
  loadmsgEl.textContent = "loading data package";
  const pkg = await loadPackageFromFetch(DATA);
  const t = worldTransform(pkg.terrain);

  loadmsgEl.textContent = "baking sun shadows + curvature (DEM)";
  await new Promise((r) => setTimeout(r, 16));
  const shadow = bakeSunShadows(pkg.terrain);
  const curvature = bakeCurvature(pkg.terrain);

  loadmsgEl.textContent = "building albedo + micro-relief";
  await new Promise((r) => setTimeout(r, 16));
  const luma = await loadOrthoLuma(1024);
  const tex = buildTerrainTextures(pkg, t, luma, shadow, curvature);

  // scene contents
  scene.add(buildSky(sunDir));

  const hemisphere = new THREE.HemisphereLight("#7a4a30", "#0d0704", 0.68);
  scene.add(hemisphere);
  scene.add(new THREE.AmbientLight("#ffd9b8", 0.16));
  const key = new THREE.DirectionalLight("#ffd3a8", 2.2);
  key.position.copy(sunDir.clone().multiplyScalar(9000));
  scene.add(key);
  const rim = new THREE.DirectionalLight("#ff9d63", 0.7);
  rim.position.set(5200, 1500, 5600);
  scene.add(rim);



  scene.add(buildBlockSides(pkg, t, buildStrataTexture()));
  scene.add(buildTerrain(pkg, t, tex));
  scene.add(buildBase(pkg, t));
  scene.add(buildDust());

  // the REAL planned route (same kernel the app runs), terrain-aware strategy
  const site = pkg.sites.find((s) => s.id === "SITE-A") ?? pkg.sites[0];
  if (site) {
    const result = planRoundTrip(pkg, {
      requestId: "lookdev",
      startXM: pkg.scenario.base.xM,
      startYM: pkg.scenario.base.yM,
      targetSiteId: site.id,
      strategies: ["terrain-aware"],
      blockMask: null,
      initialResources: { oxygen: 100, battery: 100 },
      reserveFractions: { oxygen: 0.2, battery: 0.2 },
      stopMinutes: 30,
      paramsVersion: PARAMS_VERSION,
    });
    const cand = result.candidates[0];
    if (cand) {
      const pts = cand.outbound.pathCells.map(([r, c]) => {
        const p = cellWorldPosition(pkg.terrain, t, r, c, 0);
        return new THREE.Vector3(p.x, p.y * VK + 1.4, p.z);
      });
      routeCurve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.05);
      if (pts.length > 2) {
        const ribbon = buildRouteRibbon(pkg, t, pts, new THREE.Color("#fff0d4"));
        if (ribbon) {
          ribbon.geometry.rotateY(0); // no-op, keeps intent explicit
          scene.add(ribbon);
          routeRibbonMat = ribbon.material as THREE.ShaderMaterial;
        }
      }
      // science-site ring, as in the app
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(70, 2.4, 6, 72),
        new THREE.MeshBasicMaterial({ color: "#ffb45e" }),
      );
      const sp = cellWorldPosition(pkg.terrain, t, site.rowCol[0], site.rowCol[1], 0);
      ring.position.set(sp.x, sp.y * VK + 3, sp.z);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);

      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.2, 26, 6),
        new THREE.MeshBasicMaterial({ color: "#ffcf9a" }),
      );
      pin.position.set(sp.x, sp.y * VK + 13, sp.z);
      scene.add(pin);

      scene.add(buildRocks(pkg, t, pts));
    }
  }

  setMode("overview", true);
  loadingEl.classList.add("done");
}

/* ------------------------------------------------------------------ */
/* camera shots                                                        */
/* ------------------------------------------------------------------ */

interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

let mode: Mode = "overview";
let modeChangedAt = 0;
let helmetU = 0;
let tourStep = 0;
let tourNextAt = 0;

function desiredPose(): Pose {
  if (mode === "helmet" && routeCurve) {
    const u = clamp(helmetU, 0.001, 0.999);
    const p = routeCurve.getPointAt(u);
    const ahead = routeCurve.getPointAt(clamp(u + 0.035, 0, 1));
    return {
      pos: new THREE.Vector3(p.x, p.y + 2.6, p.z),
      target: new THREE.Vector3(ahead.x, ahead.y + 1.2, ahead.z),
      fov: 66,
    };
  }
  if (mode === "low") {
    return {
      pos: new THREE.Vector3(2600, 620, 2500),
      target: new THREE.Vector3(-500, 260, -700),
      fov: 42,
    };
  }
  return {
    pos: new THREE.Vector3(-2900, 3950, 7250),
    target: new THREE.Vector3(120, 60, 120),
    fov: 38,
  };
}

/** eased move into a new shot; null when the camera sits on its pose */
let tween: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; fromFov: number; t: number } | null = null;
const ease = (x: number): number => x * x * (3 - 2 * x);

function setMode(next: Mode, immediate = false): void {
  if (next === "tour") {
    mode = "tour";
    tourStep = -1;
    advanceTour(true);
    return;
  }
  mode = next;
  modeChangedAt = performance.now();
  helmetU = next === "helmet" ? Math.max(helmetU, 0.002) : helmetU;
  const buttons = document.querySelectorAll<HTMLButtonElement>("#shots button");
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === next)));
  suitEl.classList.toggle("on", next === "helmet");
  const pose = desiredPose();
  if (immediate) {
    tween = null;
    camera.position.copy(pose.pos);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    controls.target.copy(pose.target);
    controls.enabled = next !== "helmet";
    controls.update();
  } else {
    tween = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      fromFov: camera.fov,
      t: 0,
    };
    controls.enabled = false;
  }
}

function advanceTour(first: boolean): void {
  const steps: Array<{ mode: Exclude<Mode, "tour">; dwell: number }> = [
    { mode: "overview", dwell: 5000 },
    { mode: "low", dwell: 6000 },
    { mode: "helmet", dwell: 10000 },
  ];
  tourStep = (tourStep + 1) % steps.length;
  const step = steps[tourStep] as { mode: Exclude<Mode, "tour">; dwell: number };
  mode = step.mode;
  modeChangedAt = performance.now();
  tourNextAt = performance.now() + step.dwell;
  helmetU = step.mode === "helmet" ? 0.002 : helmetU;
  suitEl.classList.toggle("on", step.mode === "helmet");
  const pose = desiredPose();
  if (first) {
    tween = null;
    camera.position.copy(pose.pos);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    controls.target.copy(pose.target);
    controls.enabled = step.mode !== "helmet";
    controls.update();
  } else {
    tween = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      fromFov: camera.fov,
      t: 0,
    };
    controls.enabled = false;
  }
  document.querySelectorAll<HTMLButtonElement>("#shots button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.mode === "tour"));
  });
}

/* hud */
const o2El = document.getElementById("o2");
const pwrEl = document.getElementById("pwr");
const hdgEl = document.getElementById("hdg");
const altEl = document.getElementById("alt");

const clock = new THREE.Clock();
let elapsed = 0;

function animate(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  elapsed += dt;

  if (mode === "tour" && performance.now() > tourNextAt) advanceTour(false);

  if (mode === "helmet" && routeCurve) {
    const len = routeCurve.getLength();
    helmetU += (dt * 3.0) / Math.max(len, 1);
    if (helmetU > 0.995) helmetU = 0.002;
  }

  const target = desiredPose();
  if (tween !== null) {
    tween.t = Math.min(1, tween.t + dt / 1.5);
    const k = ease(tween.t);
    camera.position.lerpVectors(tween.fromPos, target.pos, k);
    controls.target.lerpVectors(tween.fromTarget, target.target, k);
    camera.fov = lerp(tween.fromFov, target.fov, k);
    camera.updateProjectionMatrix();
    if (tween.t >= 1) {
      tween = null;
      controls.enabled = mode !== "helmet";
    }
  } else if (mode === "helmet") {
    // ride the route: no orbit control, show the real interpolated position
    camera.position.lerp(target.pos, 0.35);
    controls.target.lerp(target.target, 0.35);
    camera.fov = lerp(camera.fov, target.fov, 0.2);
    camera.updateProjectionMatrix();
  }

  if (mode === "helmet") {
    // subtle head bob + helmet breathing, purely cosmetic
    camera.position.y += Math.sin(elapsed * 6.2) * 0.045;
  }
  controls.update();

  if (routeRibbonMat) routeRibbonMat.uniforms.uTime!.value = elapsed;

  // drift dust
  const dust = scene.getObjectByName("dust") as THREE.Points | undefined;
  if (dust) {
    dust.rotation.y = elapsed * 0.004;
    dust.position.x = Math.sin(elapsed * 0.05) * 120;
  }

  if (mode === "helmet") {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const heading = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    if (hdgEl) hdgEl.textContent = `${((heading + 360) % 360).toFixed(0)}°`;
    if (o2El) o2El.textContent = (82 - (elapsed % 40) * 0.12).toFixed(1);
    if (pwrEl) pwrEl.textContent = (76 - (elapsed % 40) * 0.1).toFixed(1);
    if (altEl) altEl.textContent = "1.7";
  }

  composer.render();
  requestAnimationFrame(animate);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

document.querySelectorAll<HTMLButtonElement>("#shots button").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode as Mode));
});

window.addEventListener("keydown", (e) => {
  if (e.key === "1") setMode("overview");
  if (e.key === "2") setMode("low");
  if (e.key === "3") setMode("helmet");
  if (e.key === "4") setMode("tour");
});

void init().then(() => {
  animate();
  // expose the shot switch for scripted screenshots
  (window as unknown as { lookdev: { setMode: (m: Mode) => void } }).lookdev = {
    setMode: (m: Mode) => setMode(m, true),
  };
});
