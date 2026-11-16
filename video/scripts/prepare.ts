import { writeFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPackageFromDirectory } from "../../src/data/nodeLoader.js";
import { planRoundTrip } from "../../src/routing/plan.js";
import { edgeCostModel } from "../../src/routing/graph.js";
import {
  buildMissionTimeline,
  missionStateAt,
  planEmergencyReturn,
} from "../../src/simulation/engine.js";
import {
  worldTransform,
  cellWorldPosition,
  sampleElevationM,
  worldY,
} from "../../src/domain/world.js";
import * as THREE from "three";
import { regionalGeometry } from "../../src/ui/regionalGeometry.js";
import {
  MARS_RADIUS,
  MARS_CENTRE,
  globeOrientation,
  approachPose,
  approachPlaybackRate,
  contextPresentation,
  globeSurfaceGrade,
  smoothstep,
} from "../../src/ui/marsApproach.js";
const root = resolve(import.meta.dirname, "../..");
const out = resolve(root, "video/public");
mkdirSync(out, { recursive: true });
const pkg = loadPackageFromDirectory(resolve(root, "public/data/jezero"));
const tr = worldTransform(pkg.terrain);
const xyz = (x: number, y: number) => [
  (x - tr.halfWidthM) / 1000,
  worldY(tr, sampleElevationM(pkg.terrain, x, y, tr.datumM)) / 1000,
  (tr.halfHeightM - y) / 1000,
];
const cell = (rc: [number, number]) => {
  const p = cellWorldPosition(pkg.terrain, tr, ...rc, 8);
  return [p.x / 1000, p.y / 1000, p.z / 1000];
};
const site = pkg.sites.find((s) => s.id === "SITE-B")!;
const result = planRoundTrip(pkg, {
  requestId: "film-closure",
  startXM: pkg.scenario.base.xM,
  startYM: pkg.scenario.base.yM,
  targetSiteId: site.id,
  strategies: ["shortest", "terrain-aware"],
  stopMinutes: site.samplingDurationMin,
  initialResources: pkg.scenario.initialResources,
  reserveFractions: pkg.scenario.reserveFractions,
  paramsVersion: "film-project-defaults",
});
if (!result.recommended) throw new Error("Film needs a feasible plan");
const tl = buildMissionTimeline(
  result,
  pkg.terrain,
  edgeCostModel(pkg.scenario.movementParameters, result.recommended.strategy),
  pkg.scenario.movementParameters.passabilitySlopeThresholdDeg,
  {
    initialResources: pkg.scenario.initialResources,
    reserveFractions: pkg.scenario.reserveFractions,
  },
);
const ev = pkg.scenario.events.find((e) => e.type === "area_closure")!;
if (ev.geometry.type !== "rectangle")
  throw new Error("Expected closure rectangle");
const mask = new Uint8Array(256 * 256);
for (let r = ev.geometry.rows[0]; r < ev.geometry.rows[1]; r++)
  for (let c = ev.geometry.cols[0]; c < ev.geometry.cols[1]; c++)
    mask[r * 256 + c] = 1;
const at = 130;
const schedule = {
  closure: {
    id: "film-closure",
    type: "area_closure" as const,
    atSimMinutes: at,
  },
  batteryLosses: [],
};
const before = missionStateAt(tl, schedule, null, at);
const emergency = planEmergencyReturn(tl, before.position!, 0, at, mask);
if (!emergency || !emergency.reachable || emergency.insufficientReserve)
  throw new Error("Closure film must finish within reserve");
const end = at + emergency.totalMinutes;
const states = Array.from({ length: 901 }, (_, frame) => {
  const sec = frame / 30;
  const T =
    sec < 14
      ? 0
      : sec < 19.6875
        ? ((sec - 14) / 5.6875) * 129
        : sec < 20.625
          ? 130
          : Math.min(
              end,
              130 + ((sec - 20.625) / 3.75) * emergency.totalMinutes,
            );
  const st = missionStateAt(
    tl,
    schedule,
    T >= at ? { t0: at, plan: emergency } : null,
    T,
  );
  const pos = st.position
    ? xyz(st.position.xM, st.position.yM)
    : xyz(pkg.scenario.base.xM, pkg.scenario.base.yM);
  return {
    T,
    position: pos,
    oxygen: st.resources.oxygen,
    battery: st.resources.battery,
    phase: st.phase,
    leg: st.leg,
  };
});
const heights = Array.from(
  pkg.terrain.elevationsM,
  (e) => Math.round(worldY(tr, e) * 1e3) / 1e6,
);
const data = {
  width: 256,
  heights,
  base: xyz(pkg.scenario.base.xM, pkg.scenario.base.yM),
  site: { name: site.name, position: xyz(site.xM, site.yM) },
  sites: pkg.sites.map((s) => ({ name: s.name, position: xyz(s.xM, s.yM) })),
  outbound: result.recommended.outbound.pathCells.map(cell),
  returnRoute: result.recommended.returnRoute.pathCells.map(cell),
  emergency: emergency.cells.map(cell),
  closure: ev.geometry.cornersLocalM.map(([x, y]) => xyz(x, y)),
  totals: result.recommended.totals,
  margins: result.recommended.margins,
  states,
  emergencyDuration: emergency.totalMinutes,
  final: states[900],
};
writeFileSync(resolve(out, "mission.json"), JSON.stringify(data));
cpSync(
  resolve(root, "public/data/mars/viking_mdim21_color_2048.jpg"),
  resolve(out, "mars.jpg"),
);
cpSync(
  resolve(root, "public/data/jezero/imagery/ortho_5m.jpg"),
  resolve(out, "ortho.jpg"),
);
cpSync(
  resolve(root, "docs/visuals/current-overview.png"),
  resolve(out, "console.png"),
);
console.log(
  JSON.stringify(
    {
      site: site.name,
      strategy: result.recommended.strategy,
      totals: data.totals,
      emergencyMinutes: emergency.totalMinutes,
      final: data.final,
    },
    null,
    2,
  ),
);

// Freeze the application's continuous camera path and regional geometry for
// deterministic Remotion rendering. All opening coordinates are metres.
const spin = globeOrientation(
  (pkg.region.boundsLatLon.north + pkg.region.boundsLatLon.south) / 2,
  (pkg.region.boundsLatLon.east + pkg.region.boundsLatLon.west) / 2,
);
const orbit = new THREE.Vector3(
  Math.sin(0.5) * Math.sin(0.6),
  Math.cos(0.5),
  Math.sin(0.5) * Math.cos(0.6),
)
  .multiplyScalar(MARS_RADIUS * 3)
  .add(MARS_CENTRE);
const landing = new THREE.Vector3(6800, 5600, 6200),
  look = new THREE.Vector3(0, 250, 0);
const playback = [0];
while (playback.at(-1)! < 1)
  playback.push(
    Math.min(
      1,
      playback.at(-1)! + approachPlaybackRate(playback.at(-1)!) / 3000,
    ),
  );
const frames = Array.from({ length: 264 }, (_, frame) => {
  const sec = frame / 30,
    flight = Math.max(0, Math.min(1, (sec - 0.8) / 6.8));
  const at = flight * (playback.length - 1),
    lo = Math.floor(at),
    hi = Math.min(lo + 1, playback.length - 1);
  const progress = playback[lo] + (playback[hi] - playback[lo]) * (at - lo);
  const pose = approachPose(orbit, landing, look, progress);
  const range = pose.position.length(),
    lock = Math.max(0, Math.min(1, (sec - 7.6) / (263 / 30 - 7.6)));
  return {
    position: pose.position.toArray(),
    target: pose.target.toArray(),
    distance: pose.distance,
    range,
    progress,
    lock,
    globeOpacity: smoothstep(Math.log(18000), Math.log(65000), Math.log(range)),
    grade: globeSurfaceGrade(range),
    context: contextPresentation(range, sec >= 7.6 ? "off" : "dive", lock),
  };
});
const regional = regionalGeometry(pkg.terrain);
const src = readFileSync(resolve(root, "src/ui/MarsScene.tsx"), "utf8");
const vertices = [
  ...src.matchAll(/vertexShader=\{\/\* glsl \*\/ `([\s\S]*?)`/g),
].map((m) => m[1]);
const fragments = [
  ...src.matchAll(/fragmentShader=\{\/\* glsl \*\/ `([\s\S]*?)`/g),
].map((m) => m[1]);
if (vertices.length < 2 || fragments.length < 2)
  throw new Error("Application globe shaders could not be extracted");
const opening = {
  frames,
  spin: spin.toArray(),
  regional: {
    positions: Array.from(regional.getAttribute("position").array),
    uvs: Array.from(regional.getAttribute("uv").array),
    normals: Array.from(regional.getAttribute("normal").array),
    index: Array.from(regional.index!.array),
  },
  globeVertex: vertices[0],
  globeFragment: fragments[0],
  hazeVertex: vertices[1],
  hazeFragment: fragments[1],
};
writeFileSync(resolve(out, "opening.json"), JSON.stringify(opening));
cpSync(
  resolve(root, "public/data/mars/jezero_region_60km.jpg"),
  resolve(out, "region.jpg"),
);
cpSync(
  resolve(root, "public/data/mars/viking_mdim21_color_3840.jpg"),
  resolve(out, "mars-hires.jpg"),
);
cpSync(
  resolve(root, "public/data/mars/mars_normal_1024.png"),
  resolve(out, "mars-normal.png"),
);
console.log(
  "Prepared continuous Mars → region → mission opening: 264 frame samples",
);
