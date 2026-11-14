/**
 * Domain contract types (SPECIFICATION.md §3). Pure types only — no IO, no React.
 * Internal units: meters, minutes, degrees; oxygen and battery are independent
 * 0-100 simulated budget units (never liters or watt-hours).
 */

export type ResourceKind = "oxygen" | "battery";
export type Strategy = "shortest" | "terrain-aware";

export interface RegionProjection {
  name: string;
  sourceProjection: {
    name: string;
    radiusM: number;
    standardParallelDeg: number;
    centralMeridianDeg: number;
    latitudeType: string;
    source: string;
  };
  sourceProjectedOriginXYM: [number, number];
  localFrame: string;
}

export interface Region {
  schemaVersion: string;
  id: string;
  name: string;
  projection: RegionProjection;
  horizontalDatum: string;
  verticalDatum: string;
  boundsLocalM: { originXM: number; originYM: number; widthM: number; heightM: number };
  boundsLatLon: { north: number; south: number; west: number; east: number };
  transform: string;
  grid: {
    widthCells: number;
    heightCells: number;
    cellSizeM: number;
    rowOrder: string;
    colOrder: string;
    cellCenterLocalM: string;
  };
  sourceIds: string[];
  frozenAt: string;
}

export interface TerrainGrid {
  /** columns, east-positive */
  readonly width: number;
  /** rows, row 0 = north, rows increase south */
  readonly height: number;
  readonly cellSizeM: number;
  /** local-frame y of the north outer edge (= region heightM) */
  readonly originYM: number;
  /** row-major, first row north; unknown cells hold fill values and must not be used */
  readonly elevationsM: Float32Array;
  /** 1 = valid elevation, 0 = unknown (never passable, never rendered as 0 m) */
  readonly validMask: Uint8Array;
  readonly slopeDeg: Float32Array;
  readonly sourceIds: string[];
}

export interface ScienceSite {
  id: string;
  name: string;
  xM: number;
  yM: number;
  rowCol: [number, number];
  objective: string;
  positionUncertaintyM: number;
  positioningMethod: string;
  sourceIds: string[];
  imageIds: string[];
  samplingDurationMin: number;
}

export interface MovementParameters {
  passabilitySlopeThresholdDeg: number;
  baseSpeedMPM: number;
  slopeTimeFactorPerDeg: number;
  ascentPenaltyMinPerM: number;
}

export interface ResourceRates {
  oxygenPerMin: number;
  batteryPerMin: number;
}

export interface ScenarioEvent {
  id: string;
  type: "battery_loss" | "area_closure";
  kind: "simulated";
  geometry:
    | { type: "circle"; centerRowCol: [number, number]; centerLocalM: [number, number]; radiusM: number }
    | { type: "rectangle"; rows: [number, number]; cols: [number, number]; cornersLocalM: number[][] };
  note: string;
}

export interface Scenario {
  schemaVersion: string;
  id: string;
  base: {
    id: string;
    name: string;
    xM: number;
    yM: number;
    rowCol: [number, number];
    note: string;
  };
  availableSiteIds: string[];
  initialResources: Record<ResourceKind, number>;
  reserveFractions: Record<ResourceKind, number>;
  movementParameters: MovementParameters;
  resourceRates: ResourceRates;
  events: ScenarioEvent[];
  assumptionIds: string[];
}

export interface SourcesManifest {
  schemaVersion: string;
  rawInputFiles: Record<string, { bytes: number; sha256: string; retrievedAt: string }>;
  sources: Array<{
    id: string;
    mission: string;
    instrument: string | null;
    title: string;
    sourceUrl: string;
    productId: string | null;
    retrievedAt: string;
    observationTime: string | null;
    units: string | null;
    credit: string;
    usageTerms: string;
    limitations: string;
  }>;
  assumptions: {
    note: string;
    entries: Array<{ id: string; value: string; range: string; why?: string }>;
  };
  classification: { observed: string[]; derived: string[]; simulated: string[] };
}

export interface RouteRequest {
  requestId: string;
  startXM: number;
  startYM: number;
  /** either a site id or explicit coordinates */
  targetSiteId?: string;
  targetXM?: number;
  targetYM?: number;
  strategies: Strategy[];
  /** 1 = blocked cell overlay (event closure), null = no closure */
  blockMask?: Uint8Array | null;
  initialResources: Record<ResourceKind, number>;
  reserveFractions: Record<ResourceKind, number>;
  stopMinutes: number;
  /** recorded in the result for traceability */
  paramsVersion: string;
}

export interface RouteLeg {
  pathCells: Array<[number, number]>;
  distanceM: number;
  minutes: number;
  ascentM: number;
  oxygen: number;
  battery: number;
}

export type RouteStatus = "feasible" | "over_budget" | "unreachable" | "invalid_input";

export type ReasonCode =
  | "unknown_terrain"
  | "slope_blocked"
  | "event_closed"
  | "start_unreachable"
  | "target_unreachable"
  | "over_budget_oxygen"
  | "over_budget_battery"
  | "invalid_input"
  | "no_feasible_candidate_in_current_strategies";

export interface SnapInfo {
  requestedXM: number;
  requestedYM: number;
  row: number;
  col: number;
  snapDistanceM: number;
}

export interface StrategyCandidate {
  strategy: Strategy;
  status: "feasible" | "over_budget";
  outbound: RouteLeg;
  returnRoute: RouteLeg;
  stopMinutes: number;
  totals: { distanceM: number; minutes: number; oxygen: number; battery: number };
  /** initial - reserve - total, per resource (planning-time reserve margin) */
  margins: { oxygen: number; battery: number };
  reasonCodes: ReasonCode[];
}

export interface RouteResult {
  requestId: string;
  status: RouteStatus;
  candidates: StrategyCandidate[];
  /** among feasible candidates: lowest total minutes; null when none feasible */
  recommended: StrategyCandidate | null;
  reasonCodes: ReasonCode[];
  /** honest wording; never claims global optimality or all-possible-paths infeasibility */
  message: string;
  snap: { start: SnapInfo; target: SnapInfo } | null;
  dataVersions: { region: string; scenario: string; terrain: string };
  paramsVersion: string;
  measuredMs: number;
}
