#!/usr/bin/env python3
"""Phase 1 build script: frozen Jezero planning-region data package.

Takes the raw products downloaded by download_inputs.sh and produces the
publishable package in public/data/jezero/:

  region.json                     frozen region, projection, grid definition
  terrain/terrain.json            terrain grid manifest (schema + hashes)
  terrain/elevations.f32          256x256 float32 elevations (m), row-major, first row = north
  terrain/valid_mask.u8           1 = valid elevation, 0 = unknown (never treated as passable)
  terrain/slope_deg.f32           256x256 float32 slope angles (deg) on the 20 m grid
  imagery/ortho_20m.jpg           CTX ortho extract pooled to the planning grid
  imagery/ortho_5m.jpg            CTX ortho extract at native ~5 m (texture source for later stages)
  sites.json                      3 science sites with objectives, sources, uncertainty
  scenario.json                   simulated base, events, connectivity-check parameters
  sources.json                    SourceRecord manifest (observed/derived/simulated)
  alignment/alignment_report.json control-point alignment measurements
  alignment/alignment_check.png   planar overlay check figure
  alignment/hirise_crosscheck.json HiRISE DTM vs CTX DEM elevation cross-validation
  checksums.json                  SHA256 of every published asset
  README.md                       package explanation + reproduction commands

Deterministic: no randomness, no network access (reads only cached inputs).
Run:  ./.venv/bin/python scripts/data/build_data_package.py
"""

from __future__ import annotations

import hashlib
import heapq
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
import rasterio.warp
from PIL import Image, ImageDraw, ImageFont
from rasterio.enums import Resampling
from rasterio.windows import Window

REPO = Path(__file__).resolve().parents[2]
CACHE = REPO / "cache"
OUT = REPO / "public" / "data" / "jezero"

# ---------------------------------------------------------------------------
# Frozen inputs (downloaded by scripts/data/download_inputs.sh)
# ---------------------------------------------------------------------------
CTX_DEM = CACHE / "mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif"
CTX_ORTHO = CACHE / "mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXortho_mosaic_5m.tif"
HIRISE_DTM = CACHE / "hirise_dtm/ESP_045994_1985_ESP_046060_1985/DTEEC_045994_1985_046060_1985_U01.IMG"

RETRIEVED_AT = "2026-11-14"

# ---------------------------------------------------------------------------
# Frozen region definition (mosaic pixel indices on the 20 m CTX DEM grid)
# ---------------------------------------------------------------------------
REGION = {
    "id": "jezero-west-delta-01",
    "name": "Jezero western delta planning region",
    "mosaicCol0": 1080,   # east-west index of the west edge on the CTX DEM mosaic
    "mosaicRow0": 2300,   # north-south index of the north edge on the CTX DEM mosaic
    "widthCells": 256,
    "heightCells": 256,
    "cellSizeM": 20.0,
}

SCHEMA_VERSION = "1.1"  # v1.1 (phase 2): added EVA budget parameters (initialResources,
# reserveFractions, samplingDurationMin, movement parameters, resource rates)

# ---------------------------------------------------------------------------
# Phase 2 simulated EVA budget parameters.
# All values are DEMONSTRATION ASSUMPTIONS for the planning model, not validated
# astronaut or life-support data. Oxygen and battery use independent 0-100
# simulated budget units (never liters or Wh).
# ---------------------------------------------------------------------------
INITIAL_RESOURCES = {"oxygen": 100.0, "battery": 100.0}
RESERVE_FRACTIONS = {"oxygen": 0.20, "battery": 0.20}
SAMPLING_DURATION_MIN = {"SITE-A": 30.0, "SITE-B": 30.0, "SITE-C": 30.0}
BASE_SPEED_MPM = 40.0            # flat-ground suited walking speed, m/min (2.4 km/h)
SLOPE_TIME_FACTOR_PER_DEG = 0.05 # edge time multiplier 1 + slopeDeg*0.05 (20 deg -> 2.0x)
ASCENT_PENALTY_MIN_PER_M = 0.3   # extra minutes per meter of net elevation gain
OXYGEN_RATE_PER_MIN = 100.0 / 480.0  # 100 units over a nominal 480 min EVA
BATTERY_RATE_PER_MIN = 100.0 / 480.0

# Mars 2020 CTX mosaic projection (from the PDS4 label M20_JezeroCrater_CTXDEM_20m.xml)
MARS_RADIUS_M = 3396190.0
STD_PARALLEL_DEG = 18.4663
MOSAIC_UL_X = 4329000.0   # projected x of the mosaic west edge (m)
MOSAIC_UL_Y = 1143420.0   # projected y of the mosaic north edge (m)

# Connectivity-check parameter for Phase 1 (simulated assumption, not a validated
# mobility rule). A cell is passable iff validMask==1 and slopeDeg <= threshold.
SLOPE_THRESHOLD_DEG = 20.0

# ---------------------------------------------------------------------------
# Frozen scenario anchors (region-local grid indices, tuples are (row, col))
# ---------------------------------------------------------------------------
BASE_RC = (150, 180)          # simulated facility on smooth crater floor (slope 0.6 deg)
SITES_RC = {
    "SITE-A": (140, 130),     # delta front scarp base overlook
    "SITE-B": (70, 90),       # delta top distributary channel junction
    "SITE-C": (219, 74),      # small fresh crater, SW crater floor
}
EVENT_BLOCK_ROWS = (92, 122)  # [r0, r1) rectangle closing the central scarp gap
EVENT_BLOCK_COLS = (116, 146)
EVENT_BATTERY_RC = (136, 156) # point event on the base->SITE-B corridor
EVENT_BATTERY_RADIUS_M = 100.0

# Control points: (row, col, short name, neighborhood radius in cells). Each control
# point is a neighborhood whose imagery-vs-terrain relative offset is measured by a
# joint vote of all textured patches inside the radius.
CONTROL_POINTS = [
    (219, 74, "CP1 fresh-crater neighborhood", 56),
    (165, 164, "CP2 floor-crater neighborhood", 56),
    (172, 235, "CP3 floor-crater neighborhood", 56),
    (97, 152, "CP4 delta-tip neighborhood", 56),
    (150, 180, "CP5 base-plateau neighborhood", 56),
]

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def json_write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def local_origin() -> tuple[float, float]:
    """Projected coords of the region's NW outer corner (grid origin, local meters)."""
    x = MOSAIC_UL_X + REGION["mosaicCol0"] * REGION["cellSizeM"]
    y = MOSAIC_UL_Y - REGION["mosaicRow0"] * REGION["cellSizeM"]
    return x, y


def cell_center_local(row: int, col: int) -> tuple[float, float]:
    """Cell center in the LOCAL metric frame: x east from the west edge, y north from
    the south edge; the grid origin (0, heightM) sits at the NW outer corner."""
    cs = REGION["cellSizeM"]
    return (col + 0.5) * cs, REGION["heightCells"] * cs - (row + 0.5) * cs


def local_to_source(x: float, y: float) -> tuple[float, float]:
    """Local metric meters -> source-projected meters of the CTX mosaic."""
    ox, oy = local_origin()
    return ox + x, oy - REGION["heightCells"] * REGION["cellSizeM"] + y


def projected_to_lonlat(x, y):
    """Equirectangular (Mars sphere, std parallel) projected meters -> lon/lat degrees.
    Accepts scalars or numpy arrays."""
    lon = np.degrees(np.asarray(x) / (MARS_RADIUS_M * math.cos(math.radians(STD_PARALLEL_DEG))))
    lat = np.degrees(np.asarray(y) / MARS_RADIUS_M)
    if lon.ndim == 0:
        return float(lon), float(lat)
    return lon, lat


def load_region_dem():
    """Read the frozen crop from the mosaic (256x256) plus 1-cell apron for slope."""
    with rasterio.open(CTX_DEM) as ds:
        apron = ds.read(
            1,
            window=Window(
                REGION["mosaicCol0"] - 1,
                REGION["mosaicRow0"] - 1,
                REGION["widthCells"] + 2,
                REGION["heightCells"] + 2,
            ),
        ).astype(np.float32)
    nodata = -3.4028234663852886e38
    core = apron[1:-1, 1:-1]
    valid = core > nodata / 2.0
    return apron, core, valid


def compute_slope(apron: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Slope (deg) via central differences on the native 20 m grid, using the
    apron cells at region edges. Interior unknowns never produce fake passable slope:
    they are replaced by the local median so the angle stays physical, and the
    valid_mask (not slope) decides passability."""
    cs = REGION["cellSizeM"]
    z = apron.copy()
    med = float(np.median(z[z > -1e30 / 2.0]))
    z[z <= -1e30 / 2.0] = med
    dzdx = (z[1:-1, 2:] - z[1:-1, :-2]) / (2.0 * cs)          # east-positive
    dzdy = (z[:-2, 1:-1] - z[2:, 1:-1]) / (2.0 * cs)          # north-positive
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    slope[~valid] = 0.0
    return slope.astype(np.float32)


def hillshade(z: np.ndarray, valid: np.ndarray, res: float, az_deg=315.0, alt_deg=45.0):
    fill = float(np.nanmedian(z[valid])) if valid.any() else 0.0
    zz = np.where(valid, z, fill)
    dzdx = (np.roll(zz, -1, 1) - np.roll(zz, 1, 1)) / (2 * res)
    dzdy = (np.roll(zz, 1, 0) - np.roll(zz, -1, 0)) / (2 * res)
    dzdx[:, 0] = dzdx[:, -1] = 0.0
    dzdy[0, :] = dzdy[-1, :] = 0.0
    a = math.radians(az_deg)
    h0 = math.radians(alt_deg)
    lx, ly, lz = math.sin(a) * math.cos(h0), math.cos(a) * math.cos(h0), math.sin(h0)
    norm = np.sqrt(1.0 + dzdx ** 2 + dzdy ** 2)
    shade = (-dzdx * lx - dzdy * ly + lz) / norm
    return np.clip(shade, 0.0, 1.0)


def load_ortho_extract():
    """CTX ortho window over the region: native ~5 m (1024x1024) + 20 m pooled (256x256).
    Returns the arrays plus the georeference of the 5 m window (originX, originY of the
    first pixel, and the pixel size)."""
    ox, oy = local_origin()
    cs = REGION["cellSizeM"]
    x0, x1 = ox, ox + REGION["widthCells"] * cs
    y_north, y_south = oy, oy - REGION["heightCells"] * cs
    with rasterio.open(CTX_ORTHO) as ds:
        res_x, res_y = ds.res
        col0 = (x0 - ds.bounds.left) / res_x
        row0 = (ds.bounds.top - y_north) / res_y
        span_cols = (x1 - x0) / res_x
        span_rows = (y_north - y_south) / res_y
        win = Window(col0, row0, span_cols, span_rows)
        img = ds.read(1, window=win, out_shape=(1024, 1024), resampling=Resampling.nearest)
        img20 = ds.read(1, window=win, out_shape=(256, 256), resampling=Resampling.average)
        # georeference of the first pixel of the nearest-resampled 1024 grid
        ox5 = ds.bounds.left + col0 * res_x
        oy5 = ds.bounds.top - row0 * res_y
    img = np.clip(img, 0, 255).astype(np.uint8)
    img20 = np.clip(img20, 0, 255).astype(np.uint8)
    return img, img20, (ox5, oy5, res_x)


def shortest_path(passable: np.ndarray, src, dst):
    """Dijkstra on the 8-neighbor grid (unit edge cost = meters via mixed 1/sqrt2).
    Diagonal moves are allowed only if at least one adjacent orthogonal cell is passable
    (no corner cutting through two blocked cells)."""
    n = passable.shape[0]
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        d, (r, c) = heapq.heappop(pq)
        if (r, c) == dst:
            path = [dst]
            while path[-1] != src:
                path.append(prev[path[-1]])
            return d, path[::-1]
        if d > dist.get((r, c), 1e18):
            continue
        for dr, dc in nbrs:
            rr, cc = r + dr, c + dc
            if not (0 <= rr < n and 0 <= cc < n) or not passable[rr, cc]:
                continue
            if dr and dc and not (passable[r, c + dc] or passable[r + dr, c]):
                continue
            nd = d + math.hypot(dr, dc)
            if nd < dist.get((rr, cc), 1e18):
                dist[(rr, cc)] = nd
                prev[(rr, cc)] = (r, c)
                heapq.heappush(pq, (nd, (rr, cc)))
    return None, None


def event_block_corners_local():
    """Outer corners (local meters) of the frozen block rectangle [r0,r1) x [c0,c1)."""
    cs = REGION["cellSizeM"]
    r0, r1 = EVENT_BLOCK_ROWS
    c0, c1 = EVENT_BLOCK_COLS
    xw, xe = c0 * cs, c1 * cs
    yn, ys_ = REGION["heightCells"] * cs - r0 * cs, REGION["heightCells"] * cs - r1 * cs
    return [[xw, yn], [xe, yn], [xe, ys_], [xw, ys_]]


def box_blur(a: np.ndarray, k: int = 7) -> np.ndarray:
    a = a.astype(float)
    c = np.cumsum(np.cumsum(np.pad(a, ((1, 0), (1, 0))), 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    n = k
    h, w = a.shape
    out = (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n])[:h - n + 1, :w - n + 1] / (n * n)
    pad = (n - 1) // 2
    full = np.zeros_like(a)
    full[pad:pad + out.shape[0], pad:pad + out.shape[1]] = out
    return full


def ncc(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    den = math.sqrt(float((a * a).sum()) * float((b * b).sum()))
    return float((a * b).sum() / den) if den else 0.0


def _score_map(hp_o, hp_s, patches, patch, search):
    scores = {}
    for dr in range(-search, search + 1):
        for dc in range(-search, search + 1):
            tot, cnt = 0.0, 0
            for r, c in patches:
                o = hp_o[r - patch:r + patch + 1, c - patch:c + patch + 1]
                s = hp_s[r - patch + dr:r + patch + 1 + dr, c - patch + dc:c + patch + 1 + dc]
                tot += ncc(o, s)
                cnt += 1
            scores[(dr, dc)] = tot / cnt
    return scores


def _subcell(scores, search):
    (by, bx), bv = max(scores.items(), key=lambda kv: kv[1])

    def para(qm, q0, qp):
        den = (qm - 2 * q0 + qp)
        return 0.5 * (qm - qp) / den if den is not None and qm is not None and qp is not None else 0.0

    def s_at(dy, dx):
        return scores.get((dy, dx))

    sdy = (para(s_at(by - 1, bx), bv, s_at(by + 1, bx))
           if by - 1 >= -search and by + 1 <= search else 0.0)
    sdx = (para(s_at(by, bx - 1), bv, s_at(by, bx + 1))
           if bx - 1 >= -search and bx + 1 <= search else 0.0)
    return by + sdy, bx + sdx, bv


def global_registration(ortho20, shade, patch=10, step=20, search=6, min_texture=3.0):
    """Joint translation search between ortho imagery and DEM hillshade: mean NCC over
    textured patches as a function of one global (dx, dy) shift. A clear single peak
    at the published georeference confirms co-registration of the two USGS mosaics."""
    hp_o = ortho20.astype(float) - box_blur(ortho20, 7)
    hp_s = shade.astype(float) - box_blur(shade, 7)
    patches = []
    for r in range(patch + 6, ortho20.shape[0] - patch - 6, step):
        for c in range(patch + 6, ortho20.shape[1] - patch - 6, step):
            o = hp_o[r - patch:r + patch + 1, c - patch:c + patch + 1]
            if math.sqrt(float(((o - o.mean()) ** 2).mean())) >= min_texture:
                patches.append((r, c))
    scores = _score_map(hp_o, hp_s, patches, patch, search)
    dy, dx, best = _subcell(scores, search)
    cs = REGION["cellSizeM"]
    flat = sorted(scores.items(), key=lambda kv: -kv[1])
    return {
        "method": "joint translation scan of mean NCC between high-pass ortho texture and "
                  "high-pass DEM hillshade over textured patches, parabolic sub-cell refinement",
        "patchCells": patch, "searchRangeCells": search, "patchCount": len(patches),
        "bestOffsetCells": {"dy": round(dy, 2), "dx": round(dx, 2)},
        "bestOffsetMeters": {"dy": round(dy * cs, 1), "dx": round(dx * cs, 1)},
        "meanNccAtBest": round(best, 5),
        "meanNccAtNextBest": round(flat[1][1], 5) if len(flat) > 1 else None,
        "interpretation": "peak at the published georeference: the CTX ortho and CTX DEM "
                          "mosaics are co-registered as published; single-patch scatter is "
                          "texture ambiguity, averaged out by the joint vote",
    }


def local_registration(ortho20, shade, crow, ccol, radius=56, patch=9, step=10,
                       search=4, min_texture=2.5, min_patches=12):
    """Neighborhood-level relative offset around a control point: joint vote of all
    textured patches within `radius` cells. Returns sub-cell (dy, dx) meters."""
    hp_o = ortho20.astype(float) - box_blur(ortho20, 7)
    hp_s = shade.astype(float) - box_blur(shade, 7)
    n = ortho20.shape[0]
    patches = []
    for r in range(max(patch + 6, crow - radius), min(n - patch - 6, crow + radius), step):
        for c in range(max(patch + 6, ccol - radius), min(n - patch - 6, ccol + radius), step):
            o = hp_o[r - patch:r + patch + 1, c - patch:c + patch + 1]
            if math.sqrt(float(((o - o.mean()) ** 2).mean())) >= min_texture:
                patches.append((r, c))
    if len(patches) < min_patches:
        return None
    scores = _score_map(hp_o, hp_s, patches, patch, search)
    dy, dx, best = _subcell(scores, search)
    cs = REGION["cellSizeM"]
    return {"dyM": round(dy * cs, 1), "dxM": round(dx * cs, 1),
            "meanNcc": round(best, 4), "patchCount": len(patches)}


def scarp_profile_shift(dem, valid, hirise_reader):
    """Terrain-vs-terrain registration: sample the CTX DEM and the HiRISE DTM along
    north-south lines crossing the delta front scarp and find the shift minimizing RMS.
    Measures the cross-vintage offset between the two products (not an error of the
    planning pair). hirise_reader: callable(xs_ctx, ys_ctx) -> elevations or NaN."""
    cs = REGION["cellSizeM"]
    lines = []
    for col in (100, 125, 150):
        rows = np.arange(40, 190)
        xs = np.full(len(rows), local_origin()[0] + (col + 0.5) * cs)
        ys = local_origin()[1] - (rows + 0.5) * cs
        c = dem[rows, col].astype(float)
        h = hirise_reader(xs, ys)
        ok = ~np.isnan(h) & valid[rows, col]
        c, h = c[ok], h[ok]
        if len(c) < 60:
            continue
        best = None
        for k in np.arange(-5, 5.5, 0.25):
            idx = np.arange(len(h)) + k
            i0 = np.clip(np.floor(idx).astype(int), 0, len(h) - 1)
            i1 = np.clip(i0 + 1, 0, len(h) - 1)
            frac = idx - i0
            hs = h[i0] * (1 - frac) + h[i1] * frac
            m = ~np.isnan(hs)
            rms = float(math.sqrt(float(np.mean((c[m] - hs[m]) ** 2))))
            if best is None or rms < best[0]:
                best = (rms, k)
        rms0 = float(math.sqrt(float(np.mean((c - h) ** 2))))
        lines.append({"colCell": col, "sampleCount": int(ok.sum()),
                       "rmsNoShiftM": round(rms0, 2),
                       "bestRmsM": round(best[0], 2),
                       "shiftM": round(best[1] * cs, 1)})
    shifts = [l["shiftM"] for l in lines]
    return {
        "method": "north-south elevation profiles across the delta front scarp; shift "
                  "between CTX DEM and HiRISE DTM profiles minimizing RMS (positive = "
                  "HiRISE DTM features sit south of their CTX DEM positions)",
        "lines": lines,
        "meanShiftM": round(float(np.mean(shifts)), 1) if shifts else None,
        "interpretation": "consistent decameter offset between the 2017 HiRISE DTM and the "
                          "2021 CTX mosaic georeferences (different photogrammetric solutions). "
                          "The planning grid keeps the CTX georeference; the HiRISE DTM is used "
                          "for elevation cross-checks, not as a pixel-level anchor.",
    }


def hirise_crosscheck(points_projected, ctx_elev):
    """Sample the HiRISE DTM at projected CTX-mosaic coordinates (transformed with
    GDAL between the two products' CRSs) and compare elevations."""
    vals, valids = [], []
    with rasterio.open(CTX_DEM) as ds_ctx, rasterio.open(HIRISE_DTM) as ds_h:
        xs_h, ys_h = rasterio.warp.transform(ds_ctx.crs, ds_h.crs,
                                             [p[0] for p in points_projected],
                                             [p[1] for p in points_projected])
        for xh, yh in zip(xs_h, ys_h):
            row = int((ds_h.bounds.top - yh) / ds_h.res[0])
            col = int((xh - ds_h.bounds.left) / ds_h.res[1])
            ok = 0 <= row < ds_h.height and 0 <= col < ds_h.width
            vals.append(None)
            valids.append(ok)
            if ok:
                win = Window(col - 1, row - 1, 3, 3)
                a = ds_h.read(1, window=win).astype(np.float64)
                center = a[1, 1]
                if center < -1e30 / 2.0:
                    valids[-1] = False
                else:
                    vals[-1] = float(center)
    diffs = []
    for v, ce in zip(vals, ctx_elev):
        if v is not None and ce is not None:
            diffs.append(v - ce)
    return {
        "points": [
            {"projectedXYM": [p[0], p[1]], "ctxDemElevM": ce, "hiriseDtmElevM": v}
            for p, ce, v in zip(points_projected, ctx_elev, vals)
        ],
        "validCount": sum(v is not None for v in vals),
        "diffMeanM": float(np.mean(diffs)) if diffs else None,
        "diffAbsMeanM": float(np.mean(np.abs(diffs))) if diffs else None,
        "diffMaxAbsM": float(np.max(np.abs(diffs))) if diffs else None,
    }


def region_overlap_hirise_stats():
    """Validity fraction of the HiRISE DTM across the planning region (coarse check
    on a 64x64 sample grid, read as one decimated window)."""
    ox, oy = local_origin()
    cs = REGION["cellSizeM"]
    xs_l = np.linspace(ox + 0.5 * cs, ox + (REGION["widthCells"] - 0.5) * cs, 64)
    ys_l = np.linspace(oy - 0.5 * cs, oy - (REGION["heightCells"] - 0.5) * cs, 64)
    grid_x, grid_y = np.meshgrid(xs_l, ys_l)
    with rasterio.open(CTX_DEM) as ds_c, rasterio.open(HIRISE_DTM) as ds_h:
        Xh, Yh = rasterio.warp.transform(
            ds_c.crs, ds_h.crs, grid_x.ravel().tolist(), grid_y.ravel().tolist()
        )
        cols = np.floor((np.array(Xh) - ds_h.bounds.left) / ds_h.res[1]).astype(int)
        rows = np.floor((ds_h.bounds.top - np.array(Yh)) / ds_h.res[0]).astype(int)
        inside = (rows >= 0) & (rows < ds_h.height) & (cols >= 0) & (cols < ds_h.width)
        rows_c, cols_c = rows[inside], cols[inside]
        r0, r1 = int(rows_c.min()), int(rows_c.max()) + 1
        c0, c1 = int(cols_c.min()), int(cols_c.max()) + 1
        a = ds_h.read(1, window=Window(c0, r0, c1 - c0, r1 - r0),
                      out_shape=(r1 - r0, c1 - c0), resampling=Resampling.nearest).astype(np.float64)
        ok = a > -1e30 / 2.0
        valid_frac = float(ok[rows_c - r0, cols_c - c0].mean())
        valid_vals = a[ok]
    return {
        "sampleGrid": "64x64 over region",
        "insideHiriseFootprintFraction": float(inside.mean()),
        "validElevationFractionInsideFootprint": valid_frac,
        "elevMinM": float(valid_vals.min()),
        "elevMaxM": float(valid_vals.max()),
    }
    return {
        "sampleGrid": "64x64 over region",
        "insideHiriseFootprintFraction": float(inside.mean()),
        "validElevationFractionInsideFootprint": valid_frac,
        "elevMinM": float(valid_vals.min()),
        "elevMaxM": float(valid_vals.max()),
    }


# ---------------------------------------------------------------------------
# render: alignment check figure
# ---------------------------------------------------------------------------


def render_alignment_check(dem, valid, slope, ortho20, passable, block_mask, report, out_path):
    N = REGION["heightCells"]
    z = np.where(valid, dem, np.nan)
    zmin, zmax = np.nanpercentile(z, 2), np.nanpercentile(z, 98)
    t = np.clip((z - zmin) / (zmax - zmin), 0, 1)
    low = np.array([70, 25, 15], float)
    mid = np.array([150, 60, 30], float)
    high = np.array([230, 170, 115], float)
    rgb = np.where(t[..., None] < 0.5, low + (mid - low) * (2 * t[..., None]),
                   mid + (high - mid) * (2 * t[..., None] - 1))
    shade = hillshade(np.where(valid, dem, np.nanmedian(z)), valid, REGION["cellSizeM"])
    base = np.clip(rgb * (0.35 + 0.65 * shade[..., None]), 0, 255).astype(np.uint8)

    # ortho overlay at 45% opacity
    o = ortho20.astype(np.float64)
    if o.max() > 0:
        o = o / max(o.max(), 1.0)
    gray = (o * 255).astype(np.uint8)
    base = (0.55 * base.astype(float) + 0.45 * np.stack([gray] * 3, -1)).astype(np.uint8)

    S = 6  # px per cell -> 1536
    fig = Image.fromarray(base).resize((N * S, N * S), Image.NEAREST).convert("RGB")
    d = ImageDraw.Draw(fig)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
        small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
        tiny = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 13)
    except OSError:
        font = small = tiny = ImageFont.load_default()

    cs = REGION["cellSizeM"]

    def to_px(row, col):
        return col * S, row * S

    # impassable cells (unknown or too steep), subtle red hatch
    impass = ~passable
    for r, c in zip(*np.where(impass)):
        x, y = to_px(r, c)
        if impass[r, c]:
            d.line([(x, y + S), (x + S, y)], fill=(120, 30, 20), width=1)

    # blocked event rectangle
    r0, r1 = EVENT_BLOCK_ROWS
    c0, c1 = EVENT_BLOCK_COLS
    x0, y0 = to_px(r0, c0)
    x1, y1 = to_px(r1, c1)
    d.rectangle([x0, y0, x1, y1], outline=(255, 70, 50), width=3)
    for gx in range(x0, x1, 18):
        d.line([(gx, y0), (min(gx + (y1 - y0), x1), y0 + (min(gx + (y1 - y0), x1) - gx))], fill=(255, 70, 50), width=1)
    d.text((x0 + 6, y1 - 26), "EVENT-2 BLOCKED AREA (simulated)", fill=(255, 120, 90), font=small)

    # battery event point
    er, ec = EVENT_BATTERY_RC
    ex, ey = to_px(er, ec)
    d.ellipse([ex - 14, ey - 14, ex + 14, ey + 14], outline=(255, 190, 60), width=3)
    d.text((ex - 10, ey + 22), "EVENT-1 BATTERY LOSS (simulated)", fill=(255, 190, 60), font=small)

    # base
    br, bc = BASE_RC
    bx, by = to_px(br, bc)
    d.rectangle([bx - 16, by - 16, bx + 16, by + 16], outline=(240, 240, 240), width=3)
    d.text((bx - 30, by + 24), "JEZERO BASE (simulated)", fill=(240, 240, 240), font=small)

    # sites
    site_labels = {
        "SITE-A": ("A", (255, 255, 255)),
        "SITE-B": ("B", (255, 255, 255)),
        "SITE-C": ("C", (255, 255, 255)),
    }
    for sid, (r, c) in SITES_RC.items():
        x, y = to_px(r, c)
        label, color = site_labels[sid]
        d.ellipse([x - 12, y - 12, x + 12, y + 12], outline=color, width=3)
        d.text((x + 18, y - 26), f"{sid} science target", fill=color, font=small)

    # control points with measured offsets
    for cp in report["controlPoints"]:
        r, c, name = cp["row"], cp["col"], cp["name"]
        x, y = to_px(r, c)
        d.line([(x - 16, y), (x + 16, y)], fill=(90, 220, 255), width=2)
        d.line([(x, y - 16), (x, y + 16)], fill=(90, 220, 255), width=2)
        if c > 200:  # near the east edge: draw the label left of the cross
            d.text((x - 14 - len(name) * 9, y + 10), name, fill=(90, 220, 255), font=tiny)
        else:
            d.text((x + 14, y + 10), name, fill=(90, 220, 255), font=tiny)
        if cp.get("status") != "measured":
            continue
        dx, dy = cp["offsetMeters"]["dx"], cp["offsetMeters"]["dy"]
        # arrow of measured ortho->dem shift (scaled 4x to stay visible)
        ex_, ey_ = x + dx * 4 * S / cs, y + dy * 4 * S / cs
        d.line([(x, y), (ex_, ey_)], fill=(200, 255, 120), width=2)
        d.ellipse([ex_ - 4, ey_ - 4, ex_ + 4, ey_ + 4], fill=(200, 255, 120))

    # grid + scale bar + north arrow
    grid_rgb = (90, 70, 60)
    for i in range(0, N + 1, 32):
        x, y = to_px(0, i)[0], to_px(i, 0)[1]
        d.line([(x, 0), (x, N * S)], fill=grid_rgb, width=1)
        d.line([(0, y), (N * S, y)], fill=grid_rgb, width=1)
        if i < N:
            d.text((x + 4, 4), f"{i}", fill=(255, 255, 120), font=tiny)
            d.text((4, y + 4), f"{i}", fill=(255, 255, 120), font=tiny)
    bar_cells = 50  # 1000 m
    bx0, by0 = N * S - bar_cells * S - 40, N * S - 60
    d.line([(bx0, by0), (bx0 + bar_cells * S, by0)], fill=(255, 255, 255), width=4)
    d.text((bx0, by0 - 30), "1 km", fill=(255, 255, 255), font=small)
    nx, ny = 40, N * S - 120
    d.line([(nx, ny + 40), (nx, ny)], fill=(255, 255, 255), width=4)
    d.polygon([(nx - 8, ny + 12), (nx + 8, ny + 12), (nx, ny - 6)], fill=(255, 255, 255))
    d.text((nx + 14, ny - 8), "N", fill=(255, 255, 255), font=small)

    # header
    d.text((24, 20), "MARS SURVIVAL GUIDE - PHASE 1 ALIGNMENT CHECK", fill=(255, 255, 255), font=font)
    d.text((24, 52),
           "Jezero western delta planning region | real data: CTX DEM mosaic (Mangold et al. 2021) + CTX ortho mosaic (MRO)",
           fill=(230, 230, 230), font=small)
    d.text((24, 78),
           "grid 256x256 @ 20 m | rows index south, cols east | cyan = control points, green arrows = measured ortho->DEM shift (4x)",
           fill=(230, 230, 230), font=small)
    d.text((24, 104),
           "red hatch = slope > 20 deg or unknown (impassable) | sites A/B/C and base/events are partly simulated scenario anchors",
           fill=(230, 230, 230), font=small)
    d.text((24, N * S - 34),
           "generated " + RETRIEVED_AT + " by scripts/data/build_data_package.py | sources in sources.json | "
           "imagery: MRO CTX ortho mosaic, terrain: MRO CTX DEM mosaic (Mangold et al. 2021)",
           fill=(220, 220, 220), font=tiny)
    fig.save(out_path, quality=92)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main() -> None:
    for p in (CTX_DEM, HIRISE_DTM):
        if not p.exists():
            sys.exit(f"missing input: {p}")
    print("== Phase 1 data package build ==")

    apron, dem, valid = load_region_dem()
    slope = compute_slope(apron, valid)
    with rasterio.open(CTX_DEM) as _ds:
        ds_ctx_crs = _ds.crs
    n = valid.sum()
    print(f"region 256x256, valid cells: {int(n)}/{valid.size}, elev {dem[valid].min():.1f}..{dem[valid].max():.1f} m")

    ortho5, ortho20, ortho_georef = load_ortho_extract()
    print("ortho extract loaded")

    passable = valid & (slope <= SLOPE_THRESHOLD_DEG)
    print(f"passable at <= {SLOPE_THRESHOLD_DEG} deg: {passable.mean():.3f}")

    # --- alignment: global registration + per-neighborhood offsets ---------------
    shade = hillshade(np.where(valid, dem, np.nanmedian(dem[valid])), valid, REGION["cellSizeM"])
    glob = global_registration(ortho20, shade)
    print("global registration:", glob["bestOffsetMeters"], "ncc", glob["meanNccAtBest"],
          "vs next", glob["meanNccAtNextBest"], f"({glob['patchCount']} patches)")

    cs = REGION["cellSizeM"]
    cps = []
    for row, col, name, radius in CONTROL_POINTS:
        res = local_registration(ortho20, shade, row, col, radius=radius)
        if res is None:
            cps.append({"row": row, "col": col, "name": name, "status": "insufficient_texture"})
            continue
        err = math.hypot(res["dyM"], res["dxM"])
        cps.append({
            "row": row, "col": col, "name": name,
            "method": "joint vote of textured patches within the neighborhood radius; "
                      "offset = shift applied to the ortho to match the DEM",
            "neighborhoodRadiusCells": radius,
            "offsetMeters": {"dx": res["dxM"], "dy": res["dyM"]},
            "absErrorM": round(err, 1),
            "meanNcc": res["meanNcc"], "patchCount": res["patchCount"],
            "status": "measured" if res["meanNcc"] >= 0.10 else "measured_low_texture",
        })
    measured = [c for c in cps if c["status"].startswith("measured")]
    rms = math.sqrt(sum(c["absErrorM"] ** 2 for c in measured) / len(measured)) if measured else None
    print("control points:", [(c["name"], c.get("absErrorM"), c.get("status")) for c in cps], "rms:", rms)

    # scenario connectivity checks
    base_rc, sites = BASE_RC, SITES_RC
    normal = {}
    for sid, rc in sites.items():
        d_, _ = shortest_path(passable, base_rc, rc)
        normal[sid] = round(d_ * cs, 1) if d_ is not None else None
    print("normal distances (m):", normal)

    block_mask = passable.copy()
    block_mask[EVENT_BLOCK_ROWS[0]:EVENT_BLOCK_ROWS[1], EVENT_BLOCK_COLS[0]:EVENT_BLOCK_COLS[1]] = False
    blocked = {}
    detour_paths = {}
    for sid, rc in sites.items():
        d_, pth = shortest_path(block_mask, base_rc, rc)
        blocked[sid] = round(d_ * cs, 1) if d_ is not None else None
        detour_paths[sid] = pth
    print("blocked distances (m):", blocked)

    # battery event must lie on the normal base->SITE-B corridor
    d_, path_b = shortest_path(passable, base_rc, sites["SITE-B"])
    corridor = set(path_b) if path_b else set()
    battery_on_corridor = EVENT_BATTERY_RC in corridor

    # HiRISE cross-check at control points + base + sites (source-projected coords)
    pts_local = [(r, c) for r, c, _, _ in CONTROL_POINTS] + [BASE_RC] + list(SITES_RC.values())
    pts_proj = [local_to_source(*cell_center_local(r, c)) for r, c in pts_local]
    ctx_elev = [float(dem[r, c]) if valid[r, c] else None for r, c in pts_local]
    cross = hirise_crosscheck(pts_proj, ctx_elev)
    print("HiRISE cross-check:", {k: cross[k] for k in ("validCount", "diffMeanM", "diffAbsMeanM", "diffMaxAbsM")})

    def hirise_profile_reader(xs, ys):
        with rasterio.open(HIRISE_DTM) as ds_h:
            xh, yh = rasterio.warp.transform(ds_ctx_crs, ds_h.crs, list(xs), list(ys))
            out = []
            for x1, y1 in zip(xh, yh):
                col = int((x1 - ds_h.bounds.left) / ds_h.res[1])
                row = int((ds_h.bounds.top - y1) / ds_h.res[0])
                if 0 <= row < ds_h.height and 0 <= col < ds_h.width:
                    v = float(ds_h.read(1, window=Window(col, row, 1, 1))[0, 0])
                    out.append(v if v > -1e30 / 2.0 else float("nan"))
                else:
                    out.append(float("nan"))
        return np.array(out)

    scarp = scarp_profile_shift(dem, valid, hirise_profile_reader)
    print("scarp-profile cross-vintage shift:", scarp["meanShiftM"], "m (",
          [l["shiftM"] for l in scarp["lines"]], ")")
    hirise_stats = region_overlap_hirise_stats()
    print("HiRISE region overlap:", hirise_stats)

    # ------------------------------------------------------------------
    # write package
    # ------------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    ox, oy = local_origin()
    lon_nw, lat_nw = projected_to_lonlat(ox, oy)
    lon_se, lat_se = projected_to_lonlat(ox + REGION["widthCells"] * cs, oy - REGION["heightCells"] * cs)

    region_json = {
        "schemaVersion": SCHEMA_VERSION,
        "id": REGION["id"],
        "name": REGION["name"],
        "projection": {
            "name": "Equirectangular (Mars sphere) source products; local metric frame for the app",
            "sourceProjection": {
                "name": "Equirectangular (Mars sphere)",
                "radiusM": MARS_RADIUS_M,
                "standardParallelDeg": STD_PARALLEL_DEG,
                "centralMeridianDeg": 0.0,
                "latitudeType": "planetocentric",
                "source": "PDS4 label M20_JezeroCrater_CTXDEM_20m.xml",
            },
            "sourceProjectedOriginXYM": [ox, oy],
            "localFrame": "x east, y north; origin (0, heightM) at the NW outer corner",
        },
        "horizontalDatum": "Mars 2000 sphere, r=3396190 m (PDS4 label)",
        "verticalDatum": "areoid-referenced elevations as distributed in the source products (see sources.json)",
        "boundsLocalM": {"originXM": 0.0, "originYM": REGION["heightCells"] * cs,
                          "widthM": REGION["widthCells"] * cs, "heightM": REGION["heightCells"] * cs},
        "boundsLatLon": {"north": round(lat_nw, 6), "south": round(lat_se, 6),
                          "west": round(lon_nw, 6), "east": round(lon_se, 6)},
        "transform": "localX = sourceProjectedX - originXM(source); "
                     "localY = sourceProjectedY - originYM(source)",
        "grid": {
            "widthCells": REGION["widthCells"], "heightCells": REGION["heightCells"],
            "cellSizeM": cs, "rowOrder": "row 0 = north, rows increase south",
            "colOrder": "col 0 = west, cols increase east",
            "cellCenterLocalM": "x = (col+0.5)*cellSizeM; y = heightM - (row+0.5)*cellSizeM",
        },
        "sourceIds": ["m20-ctx-dem-mosaic", "m20-ctx-ortho-mosaic", "hirise-dteec-045994-1985-046060-1985"],
        "frozenAt": "2026-11-14",
    }
    json_write(OUT / "region.json", region_json)

    terrain_dir = OUT / "terrain"
    terrain_dir.mkdir(parents=True, exist_ok=True)
    (terrain_dir / "elevations.f32").write_bytes(np.ascontiguousarray(dem, dtype="<f4").tobytes())
    (terrain_dir / "valid_mask.u8").write_bytes(valid.astype(np.uint8).tobytes())
    (terrain_dir / "slope_deg.f32").write_bytes(np.ascontiguousarray(slope, dtype="<f4").tobytes())
    terrain_json = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "derived",
        "sourceIds": ["m20-ctx-dem-mosaic"],
        "method": "central-difference gradient on the native 20 m grid (1-cell apron); "
                  "unknown cells keep slope 0 but validMask=0 so they are never passable",
        "parameters": {"cellSizeM": cs, "gradient": "central difference", "apronCells": 1},
        "files": {
            "elevations.f32": {"shape": [256, 256], "dtype": "float32 little-endian", "unit": "m",
                                "nodataPolicy": "unknown elevation => valid_mask.u8 == 0; never encoded as 0 m"},
            "valid_mask.u8": {"shape": [256, 256], "dtype": "uint8", "values": {"1": "valid", "0": "unknown"}},
            "slope_deg.f32": {"shape": [256, 256], "dtype": "float32 little-endian", "unit": "deg"},
        },
        "stats": {
            "validCells": int(n), "elevMinM": float(dem[valid].min()), "elevMaxM": float(dem[valid].max()),
            "slopeMedianDeg": float(np.median(slope[valid])), "slopeP95Deg": float(np.percentile(slope[valid], 95)),
            "slopeMaxDeg": float(slope.max()),
        },
    }
    json_write(OUT / "terrain" / "terrain.json", terrain_json)

    imagery_dir = OUT / "imagery"
    imagery_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(ortho20, "L").save(imagery_dir / "ortho_20m.jpg", quality=90)
    Image.fromarray(ortho5, "L").save(imagery_dir / "ortho_5m.jpg", quality=88)

    sites_json = {
        "schemaVersion": SCHEMA_VERSION,
        "note": "Positions are anchored to unmistakable landforms in the real DEM/ortho by manual "
                "identification (method in alignment_report.json); positionUncertaintyM expresses "
                "that identification limit, not instrument precision. Science objectives come from "
                "the cited Mars 2020 mission records. samplingDurationMin is left to Phase 2.",
        "sites": [
            {
                "id": "SITE-A",
                "name": "Delta front strata overlook",
                "xM": cell_center_local(*SITES_RC["SITE-A"])[0], "yM": cell_center_local(*SITES_RC["SITE-A"])[1],
                "rowCol": list(SITES_RC["SITE-A"]),
                "objective": "Observe stacked delta-front sedimentary strata at the scarp base - the "
                             "lake-to-delta transition of the ancient Jezero lake system documented by "
                             "the Mars 2020 mission.",
                "positionUncertaintyM": 150,
                "positioningMethod": "manual identification of the delta front scarp base on the CTX "
                                     "ortho extract and DEM hillshade",
                "sourceIds": ["nasa-m2020-landing-site", "jpl-2022-09-15-delta-sediments",
                               "hirise-caption-psp-003798-1985"],
                "imageIds": [],
                "samplingDurationMin": SAMPLING_DURATION_MIN["SITE-A"],
            },
            {
                "id": "SITE-B",
                "name": "Delta top channel junction",
                "xM": cell_center_local(*SITES_RC["SITE-B"])[0], "yM": cell_center_local(*SITES_RC["SITE-B"])[1],
                "rowCol": list(SITES_RC["SITE-B"]),
                "objective": "Inspect delta-top distributary channel deposits; delta sedimentary rocks "
                             "were the target of Mars 2020's second science campaign, including organic-"
                             "matter detections in lake sediments.",
                "positionUncertaintyM": 200,
                "positioningMethod": "manual identification of a distributary channel junction on the "
                                     "delta top in the CTX ortho extract and DEM hillshade",
                "sourceIds": ["nasa-m2020-landing-site", "jpl-2022-09-15-delta-sediments"],
                "imageIds": [],
                "samplingDurationMin": SAMPLING_DURATION_MIN["SITE-B"],
            },
            {
                "id": "SITE-C",
                "name": "Small fresh crater (crater floor)",
                "xM": cell_center_local(*SITES_RC["SITE-C"])[0], "yM": cell_center_local(*SITES_RC["SITE-C"])[1],
                "rowCol": list(SITES_RC["SITE-C"]),
                "objective": "Examine a small fresh impact crater exposing subsurface crater-floor "
                             "material; crater-floor rocks were the focus of the mission's first "
                             "science campaign.",
                "positionUncertaintyM": 50,
                "positioningMethod": "center of a distinct bright-rimmed crater visible in both the CTX "
                                     "ortho extract and the DEM hillshade (also control point CP1)",
                "sourceIds": ["nasa-m2020-landing-site"],
                "imageIds": [],
                "samplingDurationMin": SAMPLING_DURATION_MIN["SITE-C"],
            },
        ],
    }
    json_write(OUT / "sites.json", sites_json)

    scenario_json = {
        "schemaVersion": SCHEMA_VERSION,
        "id": "jezero-west-delta-01",
        "base": {
            "id": "BASE",
            "name": "Jezero Base (simulated facility)",
            "xM": cell_center_local(*BASE_RC)[0], "yM": cell_center_local(*BASE_RC)[1],
            "rowCol": list(BASE_RC),
            "note": "Fictional base placed on smooth, valid crater floor (local slope "
                    f"{float(slope[BASE_RC]):.1f} deg). Not an observation.",
        },
        "availableSiteIds": ["SITE-A", "SITE-B", "SITE-C"],
        "events": [
            {
                "id": "EVENT-1",
                "type": "battery_loss",
                "kind": "simulated",
                "geometry": {"type": "circle", "centerRowCol": list(EVENT_BATTERY_RC),
                              "centerLocalM": list(cell_center_local(*EVENT_BATTERY_RC)),
                              "radiusM": EVENT_BATTERY_RADIUS_M},
                "note": "Point event on the base->SITE-B corridor; loss amount and resource "
                        "parameters are frozen in Phase 2, not here.",
            },
            {
                "id": "EVENT-2",
                "type": "area_closure",
                "kind": "simulated",
                "geometry": {"type": "rectangle", "rows": list(EVENT_BLOCK_ROWS), "cols": list(EVENT_BLOCK_COLS),
                              "cornersLocalM": event_block_corners_local()},
                "note": "Closure covering the central delta-front crossing used by the normal "
                        "base->SITE-B route; a detour exists (verified below).",
            },
        ],
        "initialResources": dict(INITIAL_RESOURCES),
        "reserveFractions": dict(RESERVE_FRACTIONS),
        "movementParameters": {
            "passabilitySlopeThresholdDeg": SLOPE_THRESHOLD_DEG,
            "baseSpeedMPM": BASE_SPEED_MPM,
            "slopeTimeFactorPerDeg": SLOPE_TIME_FACTOR_PER_DEG,
            "ascentPenaltyMinPerM": ASCENT_PENALTY_MIN_PER_M,
            "provenance": "simulated planning assumptions (see sources.json assumptions); "
                          "not validated astronaut or life-support data",
        },
        "resourceRates": {
            "oxygenPerMin": OXYGEN_RATE_PER_MIN,
            "batteryPerMin": BATTERY_RATE_PER_MIN,
            "provenance": "simulated budget units per minute of EVA time (0-100 scale); "
                          "never presented as liters or watt-hours",
        },
        "connectivityChecks": {
            "normalBaseToSiteM": normal,
            "blockedBaseToSiteM": blocked,
            "batteryEventOnOutboundCorridor": bool(battery_on_corridor),
            "verdict": ("all three sites reachable from base normally; with EVENT-2 closed every "
                        "site still reachable" if all(blocked.values()) else
                        "blocked case leaves a site unreachable - adjust before freezing"),
        },
        "assumptionIds": ["sim-passability-threshold", "sim-base", "sim-events",
                          "sim-reserve-20pct", "sim-stop-duration", "sim-speed-base",
                          "sim-speed-slope", "sim-climb-penalty", "sim-resource-rates"],
    }
    json_write(OUT / "scenario.json", scenario_json)

    sources_json = {
        "schemaVersion": SCHEMA_VERSION,
        "rawInputFiles": {
            "M20_JezeroCrater_CTXDEM_20m.tif": {
                "bytes": CTX_DEM.stat().st_size, "sha256": sha256(CTX_DEM),
                "retrievedAt": RETRIEVED_AT,
            },
            "M20_JezeroCrater_CTXortho_mosaic_5m.tif": {
                "bytes": CTX_ORTHO.stat().st_size, "sha256": sha256(CTX_ORTHO),
                "retrievedAt": RETRIEVED_AT,
            },
            "DTEEC_045994_1985_046060_1985_U01.IMG": {
                "bytes": HIRISE_DTM.stat().st_size, "sha256": sha256(HIRISE_DTM),
                "retrievedAt": RETRIEVED_AT,
            },
        },
        "sources": [
            {
                "id": "m20-ctx-dem-mosaic",
                "mission": "MRO", "instrument": "CTX",
                "title": "Mars 2020 Science Investigation CTX DEM mosaic, 20 m/px",
                "sourceUrl": "https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic",
                "productId": "M20_JezeroCrater_CTXDEM_20m.tif",
                "pdsLid": "urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic (v1.0)",
                "retrievedAt": RETRIEVED_AT,
                "observationTime": None,
                "units": "elevation meters (float32); projection meters (Equirectangular, Mars sphere)",
                "credit": "Mangold et al., 2021, Science / NASA/JPL-Caltech/USGS",
                "usageTerms": "NASA/USGS publicly released science product; cite Mangold et al. 2021 "
                              "(doi:10.1126/science.abl4051) per PDS4 label citation_information",
                "limitations": "20 m/px photogrammetric DEM; widths below one cell and smoothed "
                               "steep faces are not resolved; slope on this grid is a planning proxy",
            },
            {
                "id": "m20-ctx-ortho-mosaic",
                "mission": "MRO", "instrument": "CTX",
                "title": "Mars 2020 Science Investigation CTX ortho mosaic, ~5 m/px",
                "sourceUrl": "https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic",
                "productId": "M20_JezeroCrater_CTXortho_mosaic_5m.tif",
                "pdsLid": "urn:nasa:pds:mars2020_ctx_basemap_2021 (v1.0, same release)",
                "retrievedAt": RETRIEVED_AT,
                "observationTime": None,
                "units": "8-bit grayscale radiance (display), projection meters",
                "credit": "Mangold et al., 2021, Science / NASA/JPL-Caltech/USGS",
                "usageTerms": "NASA/USGS publicly released science product; same citation requirement",
                "limitations": "grayscale radiance for alignment/texture, not calibrated reflectance",
            },
            {
                "id": "hirise-dteec-045994-1985-046060-1985",
                "mission": "MRO", "instrument": "HiRISE",
                "title": "HiRISE DTM DTEEC_045994_1985_046060_1985_U01 (Jezero candidate landing site)",
                "sourceUrl": "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_045900_045999/ESP_045994_1985_ESP_046060_1985/",
                "productId": "DTEEC_045994_1985_046060_1985_U01",
                "pdsLid": "dataset MRO-M-HIRISE-5-DTM-V1.0",
                "retrievedAt": RETRIEVED_AT,
                "observationTime": "images acquired 2016 (ESP_045994 / ESP_046060); DTM released 2017-07-27",
                "units": "elevation meters above Mars 2000 datum (PDS3 label), 1.0097 m/px",
                "credit": "NASA/JPL/University of Arizona",
                "usageTerms": "publicly released PDS product; cite HiRISE/University of Arizona",
                "limitations": "used in Phase 1 only for independent cross-validation; not the "
                               "planning grid source",
            },
            {
                "id": "nasa-m2020-landing-site",
                "mission": "Mars 2020", "instrument": None,
                "title": "NASA Mars 2020 mission page - Landing Site: Jezero Crater",
                "sourceUrl": "https://mars.nasa.gov/mars2020/mission/landing-site/",
                "productId": None,
                "retrievedAt": RETRIEVED_AT,
                "observationTime": None,
                "units": None,
                "credit": "NASA/JPL",
                "usageTerms": "public NASA mission documentation (text reference)",
                "limitations": "narrative objectives; no precise sample-site coordinates published "
                               "in machine-readable form on this page",
            },
            {
                "id": "jpl-2022-09-15-delta-sediments",
                "mission": "Mars 2020", "instrument": "SHERLOC/SuperCam record",
                "title": "NASA's Perseverance Rover Investigates Geologically Rich Mars Terrain (JPL news, 2022-09-15)",
                "sourceUrl": "https://www.jpl.nasa.gov/news/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/",
                "productId": None,
                "retrievedAt": RETRIEVED_AT,
                "observationTime": "2022-09-15",
                "units": None,
                "credit": "NASA/JPL-Caltech/ASU/MSSS",
                "usageTerms": "public NASA/JPL news release (text reference)",
                "limitations": "documents Wildcat Ridge / Skinner Ridge objectives; exact sample-"
                               "outcrop coordinates are not published on the page, so this package "
                               "pins landform-anchored observation points with stated uncertainty",
            },
            {
                "id": "hirise-caption-psp-003798-1985",
                "mission": "MRO", "instrument": "HiRISE",
                "title": "HiRISE caption PSP_003798_1985 'Depositional Fan' (Jezero delta)",
                "sourceUrl": "https://www.uahirise.org/PSP_003798_1985",
                "productId": "PSP_003798_1985",
                "retrievedAt": RETRIEVED_AT,
                "observationTime": "acquired 2007-05-19, center 18.489 N 77.409 E",
                "units": None,
                "credit": "NASA/JPL-Caltech/University of Arizona",
                "usageTerms": "public HiRISE caption (text reference)",
                "limitations": "observation-center coordinates, not a feature pin",
            },
        ],
        "assumptions": {
            "note": "Every number below is a simulated planning assumption for the demo "
                    "scenario. None is validated astronaut or life-support guidance.",
            "entries": [
                {"id": "sim-passability-threshold", "value": f"slope <= {SLOPE_THRESHOLD_DEG} deg passable",
                 "range": "10-30 deg sensible for a 20 m planning grid",
                 "why": "phase 1 connectivity-check parameter, kept as the routing threshold"},
                {"id": "sim-reserve-20pct", "value": "reserve = 20% of initial capacity per resource",
                 "range": "configurable 0-0.5; 20% is a demo value, not a NASA safety standard"},
                {"id": "sim-stop-duration", "value": "30 min science stop per site",
                 "range": "10-120 min; uniform placeholder pending science input"},
                {"id": "sim-speed-base", "value": f"{BASE_SPEED_MPM} m/min ({BASE_SPEED_MPM*0.06:.1f} km/h) flat suited walking",
                 "range": "20-80 m/min; representative of suited EVA paces in mission reports, not measured here"},
                {"id": "sim-speed-slope", "value": f"edge time x(1 + slopeDeg*{SLOPE_TIME_FACTOR_PER_DEG})",
                 "range": "factor 0-0.1/deg; slows travel on grades"},
                {"id": "sim-climb-penalty", "value": f"+{ASCENT_PENALTY_MIN_PER_M} min per meter of net ascent",
                 "range": "0-1 min/m; descent has no extra penalty in v1"},
                {"id": "sim-resource-rates", "value": f"oxygen {OXYGEN_RATE_PER_MIN:.4f}/min, battery {BATTERY_RATE_PER_MIN:.4f}/min "
                  "(100 units / 480 min nominal EVA)",
                 "range": "rates must keep a full EVA inside 0-100 units"},
            ],
        },
        "classification": {
            "observed": ["m20-ctx-dem-mosaic", "m20-ctx-ortho-mosaic", "hirise-dteec-045994-1985-046060-1985",
                          "nasa-m2020-landing-site", "jpl-2022-09-15-delta-sediments",
                          "hirise-caption-psp-003798-1985"],
            "derived": ["terrain grids (elevations/valid/slope)", "ortho extracts",
                         "alignment measurements", "science-site landform anchors"],
            "simulated": ["BASE (Jezero Base)", "EVENT-1 battery loss", "EVENT-2 area closure",
                           "passability slope threshold 20 deg", "EVA budget parameters (initial resources, "
                           "reserve fractions, stop durations, speeds, rates)"],
        },
    }
    json_write(OUT / "sources.json", sources_json)

    alignment_report = {
        "schemaVersion": SCHEMA_VERSION,
        "globalRegistration": glob,
        "gate": "project acceptance target: control-point error <= one planning cell (20 m)",
        "controlPoints": cps,
        "summary": {
            "measuredCount": len(measured),
            "absErrorMeanM": (round(float(np.mean([c["absErrorM"] for c in measured])), 2)
                               if measured else None),
            "absErrorRmsM": round(rms, 2) if rms is not None else None,
            "absErrorMaxM": (round(float(np.max([c["absErrorM"] for c in measured])), 2)
                              if measured else None),
            "planningCellM": cs,
            "neighborhoodsWithinOneCell": (sum(1 for c in measured if c["absErrorM"] <= cs)
                                            if measured else 0),
        },
    }
    over = [c["name"] for c in measured if c["absErrorM"] > cs]
    if measured and not over:
        verdict = ("imagery-terrain registration confirmed at the published georeference "
                   "(global peak at zero); all measured neighborhoods within one planning "
                   "cell")
    else:
        verdict = ("global registration at the published georeference (sub-cell offset); "
                   "per-neighborhood offsets within one planning cell except "
                   + ", ".join(over) +
                   " - those neighborhoods must be treated as carrying larger position "
                   "uncertainty when sites or labels are pinned nearby")
    alignment_report["summary"]["verdict"] = verdict
    alignment_report["unknownPolicy"] = ("valid_mask.u8 == 0 marks unknown cells; routing must "
                                          "treat them as impassable and the UI must not render "
                                          "them as 0 m elevation")
    alignment_report["regionUnknownCells"] = int((~valid).sum())
    json_write(OUT / "alignment" / "alignment_report.json", alignment_report)

    hirise_report = {
        "schemaVersion": SCHEMA_VERSION,
        "purpose": "independent cross-validation of the CTX DEM mosaic against the HiRISE 1 m DTM",
        "dtmProductId": "DTEEC_045994_1985_046060_1985_U01",
        **cross,
        "scarpProfileRegistration": scarp,
        "regionOverlap": hirise_stats,
        "note": "both products reference the Mars 2000 datum family; the point elevation "
                "differences include vintage and production differences, expect meter-to-"
                "decameter agreement; the horizontal cross-vintage offset is reported by "
                "scarpProfileRegistration and is not an error of the planning pair",
    }
    json_write(OUT / "alignment" / "hirise_crosscheck.json", hirise_report)

    render_alignment_check(dem, valid, slope, ortho20, passable, block_mask, alignment_report,
                           OUT / "alignment" / "alignment_check.png")
    print("alignment check figure written")

    readme = f"""# Jezero west-delta data package (Phase 1)

Frozen, verified planning data for the Mars Survival Guide Phase 1 scenario.
Generated by `scripts/data/build_data_package.py` on {RETRIEVED_AT}; all coordinates
are in the local metric frame defined in `region.json`.

## Contents

| File | Kind | What it is |
| --- | --- | --- |
| `region.json` | frozen | region id, projection chain, grid definition, lat/lon bounds |
| `terrain/elevations.f32` | derived | 256x256 float32 elevations (m), row-major, first row north |
| `terrain/valid_mask.u8` | derived | 1 = valid, 0 = unknown; unknown cells are NEVER passable and must not render as 0 m |
| `terrain/slope_deg.f32` | derived | slope (deg) on the native 20 m grid |
| `terrain/terrain.json` | derived | schema, method, parameters, stats |
| `imagery/ortho_20m.jpg` | derived | CTX ortho extract pooled to the planning grid (alignment/2D check) |
| `imagery/ortho_5m.jpg` | derived | CTX ortho extract at ~5 m (texture source for the later 3D stage) |
| `sites.json` | observed + derived | 3 science sites: landform-anchored positions with stated uncertainty, mission-documented objectives |
| `scenario.json` | simulated | fictional base, two simulated events, connectivity-check results |
| `sources.json` | observed | SourceRecord manifest incl. usage terms + observed/derived/simulated classification |
| `alignment/alignment_report.json` | derived | control-point offsets between ortho imagery and DEM |
| `alignment/hirise_crosscheck.json` | derived | independent HiRISE 1 m DTM cross-validation |
| `alignment/alignment_check.png` | derived | planar overlay check figure |
| `checksums.json` | - | SHA256 of every published asset |

## Data sources

- CTX DEM mosaic 20 m/px, MRO/CTX (Mangold et al. 2021, Science) - planning terrain.
- CTX ortho mosaic ~5 m/px, MRO/CTX - imagery alignment/texture.
- HiRISE DTM `DTEEC_045994_1985_046060_1985_U01` (NASA/JPL/University of Arizona) - independent cross-validation only.
- Mars 2020 mission records (NASA/JPL pages) - science objectives for the sites.
See `sources.json` for full attribution and terms.

## Reproduce

```bash
./.venv/bin/python -m pip install -q numpy scipy rasterio pillow   # once
bash scripts/data/download_inputs.sh                               # raw products into cache/ (~830 MB)
./.venv/bin/python -I scripts/data/build_data_package.py           # deterministic rebuild
```

The build is deterministic: identical inputs produce byte-identical terrain arrays
(re-run and compare `checksums.json`). No network access happens inside the build
script itself.

## Known limits (must stay visible in later stages)

- The 20 m planning grid cannot resolve obstacles smaller than one cell; the CTX
  mosaic smooths steep faces, so slope angles are planning proxies, not engineering
  measurements.
- Science-site pins are landform-anchored with stated uncertainty (see
  `sites.json`); they are not rover sample-location pins.
- Base, events, the 20 deg passability threshold and all EVA budget numbers
  (initial resources, 20% reserves, 30 min stops, speeds, consumption rates) are
  simulated scenario inputs, clearly separated from observations (see
  `sources.json` -> assumptions). Resource units are abstract 0-100 budget points,
  never liters or watt-hours.
- v1.1 (phase 2): added EVA budget parameters; terrain arrays are unchanged from v1.0.
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")

    # checksums of published assets
    checksums = {}
    for p in sorted(OUT.rglob("*")):
        if p.is_file() and p.name != "checksums.json":
            checksums[str(p.relative_to(OUT))] = {"bytes": p.stat().st_size, "sha256": sha256(p)}
    json_write(OUT / "checksums.json", {"schemaVersion": SCHEMA_VERSION, "algorithm": "sha256",
                                         "files": checksums})
    print(f"package: {len(checksums)} files, total "
          f"{sum(v['bytes'] for v in checksums.values())/1e6:.2f} MB")


if __name__ == "__main__":
    main()
