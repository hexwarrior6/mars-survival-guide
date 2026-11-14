/**
 * Data package parsing and validation (SPECIFICATION.md §3: every asset carries a
 * schemaVersion and is validated on load; missing/invalid data must fail loudly —
 * never silently replaced with random or synthetic data).
 *
 * The parse functions are pure and take already-read JSON objects / ArrayBuffers,
 * so the same core runs in Node (tests, CLI, validate:data) and the browser.
 */

import {
  PACKAGE_SCHEMA_VERSION,
  validateMovementParameters,
  validateResourceRates,
  isFiniteNumber,
  validateResourceAmount,
  validateReserveFraction,
} from "./assumptions.js";
import type {
  Region,
  ScienceSite,
  Scenario,
  SourcesManifest,
  TerrainGrid,
  ResourceKind,
} from "./types.js";

export class DataPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataPackageError";
  }
}

export interface RawPackageBuffers {
  region: unknown;
  terrainManifest: unknown;
  sites: unknown;
  scenario: unknown;
  sources: unknown;
  elevations: ArrayBuffer;
  validMask: ArrayBuffer;
  slopeDeg: ArrayBuffer;
}

export interface LoadedPackage {
  region: Region;
  terrain: TerrainGrid;
  sites: ScienceSite[];
  scenario: Scenario;
  sources: SourcesManifest;
}

function requireObject(v: unknown, what: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new DataPackageError(`${what} must be a JSON object`);
  }
  return v as Record<string, unknown>;
}

function requireString(o: Record<string, unknown>, key: string, what: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new DataPackageError(`${what}.${key} must be a non-empty string`);
  }
  return v;
}

function requireNumber(o: Record<string, unknown>, key: string, what: string): number {
  const v = o[key];
  if (!isFiniteNumber(v)) {
    throw new DataPackageError(`${what}.${key} must be a finite number, got ${String(v)}`);
  }
  return v;
}

function checkSchemaVersion(o: Record<string, unknown>, what: string, file?: string): string {
  const v = requireString(o, "schemaVersion", what);
  if (v !== PACKAGE_SCHEMA_VERSION) {
    throw new DataPackageError(
      `${what} schemaVersion ${v} is not supported (expected ${PACKAGE_SCHEMA_VERSION}` +
        (file ? `; file ${file}` : "") +
        ")",
    );
  }
  return v;
}

function readLEFloat32(buffer: ArrayBuffer, expectedCount: number, what: string): Float32Array {
  if (buffer.byteLength !== expectedCount * 4) {
    throw new DataPackageError(
      `${what}: expected ${expectedCount * 4} bytes for ${expectedCount} float32 values, got ${buffer.byteLength}`,
    );
  }
  const view = new DataView(buffer);
  const out = new Float32Array(expectedCount);
  for (let i = 0; i < expectedCount; i++) {
    out[i] = view.getFloat32(i * 4, true); // little-endian, matching the package spec
  }
  return out;
}

function readLEUint8(buffer: ArrayBuffer, expectedCount: number, what: string): Uint8Array {
  if (buffer.byteLength !== expectedCount) {
    throw new DataPackageError(
      `${what}: expected ${expectedCount} bytes, got ${buffer.byteLength}`,
    );
  }
  return new Uint8Array(buffer.slice(0));
}

function parseRegion(raw: unknown): Region {
  const o = requireObject(raw, "region.json");
  checkSchemaVersion(o, "region.json");
  const bounds = requireObject(o.boundsLocalM, "region.json.boundsLocalM");
  const grid = requireObject(o.grid, "region.json.grid");
  return {
    schemaVersion: o.schemaVersion as string,
    id: requireString(o, "id", "region.json"),
    name: requireString(o, "name", "region.json"),
    projection: o.projection as Region["projection"],
    horizontalDatum: requireString(o, "horizontalDatum", "region.json"),
    verticalDatum: requireString(o, "verticalDatum", "region.json"),
    boundsLocalM: {
      originXM: requireNumber(bounds, "originXM", "region.json.boundsLocalM"),
      originYM: requireNumber(bounds, "originYM", "region.json.boundsLocalM"),
      widthM: requireNumber(bounds, "widthM", "region.json.boundsLocalM"),
      heightM: requireNumber(bounds, "heightM", "region.json.boundsLocalM"),
    },
    boundsLatLon: o.boundsLatLon as Region["boundsLatLon"],
    transform: requireString(o, "transform", "region.json"),
    grid: {
      widthCells: requireNumber(grid, "widthCells", "region.json.grid"),
      heightCells: requireNumber(grid, "heightCells", "region.json.grid"),
      cellSizeM: requireNumber(grid, "cellSizeM", "region.json.grid"),
      rowOrder: requireString(grid, "rowOrder", "region.json.grid"),
      colOrder: requireString(grid, "colOrder", "region.json.grid"),
      cellCenterLocalM: requireString(grid, "cellCenterLocalM", "region.json.grid"),
    },
    sourceIds: o.sourceIds as string[],
    frozenAt: requireString(o, "frozenAt", "region.json"),
  };
}

function parseTerrain(
  raw: unknown,
  region: Region,
  elevations: ArrayBuffer,
  validMask: ArrayBuffer,
  slopeDeg: ArrayBuffer,
): TerrainGrid {
  const o = requireObject(raw, "terrain.json");
  checkSchemaVersion(o, "terrain.json");
  const width = region.grid.widthCells;
  const height = region.grid.heightCells;
  const count = width * height;
  const valid = readLEUint8(validMask, count, "terrain/valid_mask.u8");
  const elev = readLEFloat32(elevations, count, "terrain/elevations.f32");
  const slope = readLEFloat32(slopeDeg, count, "terrain/slope_deg.f32");

  const problems: string[] = [];
  for (let i = 0; i < count; i++) {
    const vm = valid[i] as number;
    if (vm !== 0 && vm !== 1) {
      problems.push(`valid_mask.u8[${i}] = ${vm} (only 0/1 allowed)`);
      if (problems.length >= 5) break;
    }
  }
  if (problems.length > 0) throw new DataPackageError(`terrain masks invalid: ${problems.join("; ")}`);

  for (let i = 0; i < count; i++) {
    if ((valid[i] as number) === 1) {
      const e = elev[i] as number;
      const s = slope[i] as number;
      if (!Number.isFinite(e)) problems.push(`elevations.f32[${i}] not finite while mask=1`);
      if (!Number.isFinite(s) || s < 0) problems.push(`slope_deg.f32[${i}] = ${s} must be finite and >= 0`);
      if (problems.length >= 5) break;
    }
  }
  if (problems.length > 0) throw new DataPackageError(`terrain arrays invalid: ${problems.join("; ")}`);

  return {
    width,
    height,
    cellSizeM: region.grid.cellSizeM,
    originYM: region.boundsLocalM.originYM,
    elevationsM: elev,
    validMask: valid,
    slopeDeg: slope,
    sourceIds: (o.sourceIds as string[]) ?? [],
  };
}

function parseSites(raw: unknown, region: Region): ScienceSite[] {
  const o = requireObject(raw, "sites.json");
  checkSchemaVersion(o, "sites.json");
  const rawSites = o.sites;
  if (!Array.isArray(rawSites)) throw new DataPackageError("sites.json.sites must be an array");
  const out: ScienceSite[] = [];
  const ids = new Set<string>();
  for (const rs of rawSites) {
    const s = requireObject(rs, "sites.json.sites[]");
    const id = requireString(s, "id", "sites.json.sites[]");
    if (ids.has(id)) throw new DataPackageError(`duplicate site id: ${id}`);
    ids.add(id);
    const xM = requireNumber(s, "xM", `site ${id}`);
    const yM = requireNumber(s, "yM", `site ${id}`);
    if (xM < 0 || xM > region.boundsLocalM.widthM || yM < 0 || yM > region.boundsLocalM.heightM) {
      throw new DataPackageError(`site ${id} at (${xM}, ${yM}) is outside region bounds`);
    }
    const stop = requireNumber(s, "samplingDurationMin", `site ${id}`);
    if (stop < 0) throw new DataPackageError(`site ${id} samplingDurationMin must be >= 0`);
    out.push({
      id,
      name: requireString(s, "name", `site ${id}`),
      xM,
      yM,
      rowCol: s.rowCol as [number, number],
      objective: requireString(s, "objective", `site ${id}`),
      positionUncertaintyM: requireNumber(s, "positionUncertaintyM", `site ${id}`),
      positioningMethod: requireString(s, "positioningMethod", `site ${id}`),
      sourceIds: (s.sourceIds as string[]) ?? [],
      imageIds: (s.imageIds as string[]) ?? [],
      samplingDurationMin: stop,
    });
  }
  return out;
}

function parseScenario(raw: unknown, region: Region): Scenario {
  const o = requireObject(raw, "scenario.json");
  checkSchemaVersion(o, "scenario.json");
  const base = requireObject(o.base, "scenario.json.base");
  const movement = requireObject(o.movementParameters, "scenario.json.movementParameters");
  const rates = requireObject(o.resourceRates, "scenario.json.resourceRates");

  const initial = requireObject(o.initialResources, "scenario.json.initialResources");
  const reserves = requireObject(o.reserveFractions, "scenario.json.reserveFractions");
  const capacity = 100; // 0-100 simulated budget units
  const resources: Record<ResourceKind, number> = { oxygen: 0, battery: 0 };
  const fractions: Record<ResourceKind, number> = { oxygen: 0, battery: 0 };
  const problems: string[] = [];
  for (const kind of ["oxygen", "battery"] as ResourceKind[]) {
    const v = initial[kind];
    if (!isFiniteNumber(v)) problems.push(`initialResources.${kind} must be a finite number`);
    else {
      const e = validateResourceAmount(`initialResources.${kind}`, v, capacity);
      if (e) problems.push(e);
      else resources[kind] = v;
    }
    const f = reserves[kind];
    if (!isFiniteNumber(f)) problems.push(`reserveFractions.${kind} must be a finite number`);
    else {
      const e = validateReserveFraction(`reserveFractions.${kind}`, f);
      if (e) problems.push(e);
      else fractions[kind] = f;
    }
  }
  if (problems.length > 0) throw new DataPackageError(`scenario.json invalid: ${problems.join("; ")}`);

  const movementParams: Scenario["movementParameters"] = {
    passabilitySlopeThresholdDeg: requireNumber(
      movement,
      "passabilitySlopeThresholdDeg",
      "scenario.json.movementParameters",
    ),
    baseSpeedMPM: requireNumber(movement, "baseSpeedMPM", "scenario.json.movementParameters"),
    slopeTimeFactorPerDeg: requireNumber(
      movement,
      "slopeTimeFactorPerDeg",
      "scenario.json.movementParameters",
    ),
    ascentPenaltyMinPerM: requireNumber(
      movement,
      "ascentPenaltyMinPerM",
      "scenario.json.movementParameters",
    ),
  };
  const movementErrors = validateMovementParameters(movementParams);
  const resourceRates: Scenario["resourceRates"] = {
    oxygenPerMin: requireNumber(rates, "oxygenPerMin", "scenario.json.resourceRates"),
    batteryPerMin: requireNumber(rates, "batteryPerMin", "scenario.json.resourceRates"),
  };
  movementErrors.push(...validateResourceRates(resourceRates));
  if (movementErrors.length > 0) {
    throw new DataPackageError(`scenario.json parameters out of range: ${movementErrors.join("; ")}`);
  }

  const availableSiteIds = o.availableSiteIds;
  if (!Array.isArray(availableSiteIds)) {
    throw new DataPackageError("scenario.json.availableSiteIds must be an array");
  }

  return {
    schemaVersion: o.schemaVersion as string,
    id: requireString(o, "id", "scenario.json"),
    base: {
      id: requireString(base, "id", "scenario.json.base"),
      name: requireString(base, "name", "scenario.json.base"),
      xM: requireNumber(base, "xM", "scenario.json.base"),
      yM: requireNumber(base, "yM", "scenario.json.base"),
      rowCol: base.rowCol as [number, number],
      note: requireString(base, "note", "scenario.json.base"),
    },
    availableSiteIds: availableSiteIds as string[],
    initialResources: resources,
    reserveFractions: fractions,
    movementParameters: movementParams,
    resourceRates,
    events: (o.events as Scenario["events"]) ?? [],
    assumptionIds: (o.assumptionIds as string[]) ?? [],
  };
}

function parseSources(raw: unknown): SourcesManifest {
  const o = requireObject(raw, "sources.json");
  checkSchemaVersion(o, "sources.json");
  return o as unknown as SourcesManifest;
}

/** Parse and cross-validate the whole package. Throws DataPackageError on any problem. */
export function parsePackage(raw: RawPackageBuffers): LoadedPackage {
  const region = parseRegion(raw.region);
  const terrain = parseTerrain(raw.terrainManifest, region, raw.elevations, raw.validMask, raw.slopeDeg);
  const sites = parseSites(raw.sites, region);
  const scenario = parseScenario(raw.scenario, region);
  const sources = parseSources(raw.sources);

  // cross-file consistency
  const problems: string[] = [];
  const siteIds = new Set(sites.map((s) => s.id));
  for (const sid of scenario.availableSiteIds) {
    if (!siteIds.has(sid)) problems.push(`scenario references unknown site ${sid}`);
  }
  if (scenario.base.xM < 0 || scenario.base.xM > region.boundsLocalM.widthM) {
    problems.push(`base xM ${scenario.base.xM} outside region`);
  }
  if (scenario.base.yM < 0 || scenario.base.yM > region.boundsLocalM.heightM) {
    problems.push(`base yM ${scenario.base.yM} outside region`);
  }
  for (const e of scenario.events) {
    if (e.geometry.type === "circle") {
      const [r, c] = e.geometry.centerRowCol;
      if (r < 0 || r >= region.grid.heightCells || c < 0 || c >= region.grid.widthCells) {
        problems.push(`event ${e.id} center outside grid`);
      }
    } else {
      const [r0, r1] = e.geometry.rows;
      const [c0, c1] = e.geometry.cols;
      if (r0 < 0 || r1 > region.grid.heightCells || c0 < 0 || c1 > region.grid.widthCells) {
        problems.push(`event ${e.id} rectangle outside grid`);
      }
    }
  }
  if (problems.length > 0) throw new DataPackageError(`package cross-check failed: ${problems.join("; ")}`);

  return { region, terrain, sites, scenario, sources };
}

/** Index helpers for the local metric frame (x east, y north, origin NW corner). */
export function cellCenter(terrain: TerrainGrid, row: number, col: number): { xM: number; yM: number } {
  return {
    xM: (col + 0.5) * terrain.cellSizeM,
    yM: terrain.originYM - (row + 0.5) * terrain.cellSizeM,
  };
}

export interface CellRef {
  row: number;
  col: number;
  snapDistanceM: number;
}

/**
 * Snap a local coordinate to the nearest cell center. Allowed only within one cell
 * width (SPECIFICATION.md §4.6); the snap distance is reported, never hidden.
 */
export function snapToCell(terrain: TerrainGrid, xM: number, yM: number): CellRef | null {
  if (!isFiniteNumber(xM) || !isFiniteNumber(yM)) return null;
  if (xM < 0 || yM < 0 || xM > terrain.width * terrain.cellSizeM || yM > terrain.originYM) {
    return null;
  }
  const colF = xM / terrain.cellSizeM - 0.5;
  const rowF = terrain.originYM / terrain.cellSizeM - yM / terrain.cellSizeM - 0.5;
  const col = Math.max(0, Math.min(terrain.width - 1, Math.round(colF)));
  const row = Math.max(0, Math.min(terrain.height - 1, Math.round(rowF)));
  const c = cellCenter(terrain, row, col);
  const snapDistanceM = Math.hypot(c.xM - xM, c.yM - yM);
  if (snapDistanceM > terrain.cellSizeM) return null; // outside one-cell snap tolerance
  return { row, col, snapDistanceM };
}
