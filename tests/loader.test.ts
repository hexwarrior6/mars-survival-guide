/**
 * Data loading validation: schema version mismatch, truncated binaries and invalid
 * masks must fail loudly (SPECIFICATION.md §3) — never silently degraded.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parsePackage } from "../src/domain/load.js";
import { DataPackageError } from "../src/domain/load.js";

const PKG_DIR = resolve(process.cwd(), "public/data/jezero");

function rawBuffers() {
  const j = (p: string): unknown => JSON.parse(readFileSync(resolve(PKG_DIR, p), "utf-8"));
  const b = (p: string): ArrayBuffer => {
    const buf = readFileSync(resolve(PKG_DIR, p));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  return {
    region: j("region.json"),
    terrainManifest: j("terrain/terrain.json"),
    sites: j("sites.json"),
    scenario: j("scenario.json"),
    sources: j("sources.json"),
    elevations: b("terrain/elevations.f32"),
    validMask: b("terrain/valid_mask.u8"),
    slopeDeg: b("terrain/slope_deg.f32"),
  };
}

describe("data package loading", () => {
  it("loads the real package without errors", () => {
    const pkg = parsePackage(rawBuffers());
    expect(pkg.region.id).toBe("jezero-west-delta-01");
    expect(pkg.terrain.width).toBe(256);
    expect(pkg.terrain.height).toBe(256);
    expect(pkg.sites.map((s) => s.id)).toEqual(["SITE-A", "SITE-B", "SITE-C"]);
    expect(pkg.scenario.initialResources.oxygen).toBe(100);
  });

  it("rejects a wrong schemaVersion", () => {
    const raw = rawBuffers();
    (raw.region as Record<string, unknown>).schemaVersion = "9.9";
    expect(() => parsePackage(raw)).toThrow(DataPackageError);
    expect(() => parsePackage(raw)).toThrow(/schemaVersion/);
  });

  it("rejects truncated elevation binary", () => {
    const raw = rawBuffers();
    raw.elevations = raw.elevations.slice(0, raw.elevations.byteLength - 4);
    expect(() => parsePackage(raw)).toThrow(DataPackageError);
    expect(() => parsePackage(raw)).toThrow(/elevations\.f32/);
  });

  it("rejects invalid mask values", () => {
    const raw = rawBuffers();
    const mask = new Uint8Array(raw.validMask.slice(0));
    mask[12345] = 7;
    raw.validMask = mask.buffer as ArrayBuffer;
    expect(() => parsePackage(raw)).toThrow(DataPackageError);
    expect(() => parsePackage(raw)).toThrow(/valid_mask/);
  });

  it("rejects NaN elevation where mask = 1", () => {
    const raw = rawBuffers();
    const elev = new Float32Array(raw.elevations.slice(0));
    // find a masked-in cell (the region is fully valid, so index 0 is fine)
    elev[0] = Number.NaN;
    raw.elevations = elev.buffer as ArrayBuffer;
    expect(() => parsePackage(raw)).toThrow(/not finite/);
  });

  it("rejects out-of-range movement parameters", () => {
    const raw = rawBuffers();
    const scenario = raw.scenario as Record<string, Record<string, unknown>>;
    (scenario.movementParameters as Record<string, unknown>).baseSpeedMPM = 9999;
    expect(() => parsePackage(raw)).toThrow(/out of range/);
  });
});
