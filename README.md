# Mars Survival Guide: Martian Map

A working Marswalk planning and mission-simulation console built for the **NASA International Space Apps Challenge 2026**, addressing [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).

Plan a science excursion from a simulated base in the western delta of Jezero Crater, compare round-trip options against a resource budget, replay the mission minute by minute, and replan an emergency return when a simulated incident hits. The terrain, imagery, and science-site objectives come from real NASA data; the mission itself is simulated, and every simulated element is labeled as such in the app.

This is a local application (run with `npm run dev`). There is no live deployment yet.

## Implemented features

### Real NASA terrain data package

- MRO CTX DEM mosaic (20 m/px) and CTX ortho mosaic (~5 m/px) covering a 5.12 × 5.12 km area of Jezero's western delta, resampled to a 256 × 256 planning grid at 20 m (`schemaVersion` 1.1, published in `public/data/jezero/`).
- Full provenance ships with the data: `sources.json` (6 source records with mission, instrument, product IDs, retrieval dates, and usage terms), SHA256 checksums for every published asset, an ortho-to-DEM alignment report with stated control-point uncertainties, and an independent HiRISE 1 m DTM cross-validation.
- All data is classified as **observed / derived / simulated**. The package rebuild is deterministic (download script + single build script); `npm run validate:data` re-verifies schema and checksums. See `public/data/jezero/README.md`.
- Science sites have mission-documented objectives (NASA/JPL Mars 2020 records) and landform-anchored positions with stated 50–200 m uncertainty — no fabricated sample coordinates.

### Deterministic route kernel

- A* and Dijkstra over an 8-neighbor graph: NoData cells, cells above the slope threshold (20°, a labeled simulation assumption), and event-blocked areas are impassable; diagonal moves through two blocked corners are rejected.
- Two strategies per request: `shortest` and `terrain-aware` (normalized, weighted slope/climb penalties).
- Edge cost is walking time with climb-direction asymmetry (net ascent adds +0.3 min/m; descent is unpenalized in v1). The return leg is always re-planned independently, never the reversed outbound path.
- Per-resource budget check: outbound + science stop + return, with a reserve that never shrinks after a battery loss. Results carry explicit statuses (`feasible` / `over_budget` / `unreachable` / `invalid_input`) and reason codes; over-budget wording is limited to "no plan satisfying the budget was found under the searched strategies".

### 3D terrain sandbox (React Three Fiber)

- Full-viewport terrain stage textured with the CTX ortho mosaic; sun direction matches the DEM shadowing convention (northwest). Routes hug the terrain: outbound warm white, return amber, emergency return amber, invalidated routes gray dashed.
- Site selection plays a two-stage camera: first focus on the site, then pull back until the whole round trip fills the frame at a close 45° oblique. Screen-space label placement keeps the selected site and base labels clear of the plan by nudging them (and hides non-selected site labels while a plan is shown); the cut-away block reads in the overview. A skippable opening camera move runs on load; `prefers-reduced-motion` goes straight to stable views.
- A display-only cut-away block (side faces, synthetic strata, lit rim, base slab) gives the plate physical weight; its top edge follows the real DEM cells and the strata pattern is labelled artistic in the legend and the sources drawer.
- A baked display surface replaces the single-band ortho and stays led by the photograph: the real CTX luminance supplies the tone and structure, a near-neutral warm tint only lifts it to screen range, and slope/curvature plus a faint DEM horizon-scan shadow modulate it by a few percent. Micro-relief normals keep close views from turning to mush. Sky gradient, ground haze, dust and a bloom chain finish the frame; all of it is display-only and labelled, and the 2D plan view still draws the untouched ortho.
- From Mars: the app opens on a real Viking MDIM 2.1 globe (NASA/JPL/USGS, public domain, shipped with the app) at true scale. Mission locations come from `public/data/missions.json`: entries with a `path` have a terrain package and can be entered (Jezero in this build); the rest are future areas marked `NO PACKAGE`. Adding a location is one manifest entry plus its package — the globe re-orients on the loaded package's lat/lon bounds and the pin appears. The globe is a trackball: drag in any direction and the surface follows, with no angle limits; the wheel zooms 1.35–4.2 R. Its material is a custom shader with a real terminator, a camera-side fill, a sun highlight and an atmospheric rim, plus a normal map derived from the albedo luminance for micro-relief (artistic, not a measured global DEM). One camera and one scene: clicking an available location dollies in three staged pushes with short holds and a loading readout, from a near-vertical orbit to the region's oblique overview (dynamic near/far, no cut); the globe fades between 70 and 30 km and a real 60 km CTX regional tile takes over, so its 1 km/px imagery is never magnified into mush, and the normal sandbox takes over. `Skip` / Esc, `?intro=off`, `?intro=auto`, `prefers-reduced-motion`, and a `From Mars` toolbar button control it. On landing a 2.4 s scan line sweeps the finished display surface; the texture is never swapped, so there is no colour jump. Skipping or reduced motion does not play it.
- Helmet cam: ride the astronaut's own eye level along the computed route (position and bearing come from the deterministic runtime, so scrubbing the timeline moves the view). Suit HUD shows O₂/PWR, leg, phase, T+, bearing and eye height; it is labelled as a simulated position with artistic near-field detail, and needs a started mission.
- A pulsing base beacon, a light travelling the planned route, and a red screen pulse when an event lands — all display-only.
- A 70 m terrain-snapped selection ring, base flag, and astronaut figure provide scale references. The astronaut is true 1.7 m scale, paired with a magnified position light pillar so the location is visible from overview distance — the legend states the pillar is not to scale.
- Robustness: a frame-stall watchdog falls back to a timer-driven render loop (background tabs keep rendering), plus a WebGL error boundary and a 2D fallback view.

### Mission simulation

- Deterministic engine: the complete mission state at simulated minute T is a pure function of T (`missionStateAt`), so replaying any moment needs no stored history.
- The astronaut walks the route with per-edge timing. Two event types can fire: battery loss and area closure. An emergency return is re-planned from the exact interpolated position (mid-edge events keep the walked position and consumed resources).
- Outcomes are shown honestly: mission complete, reserve breach after returning (amber, never green), or **STRANDED — no feasible return** (red, clock frozen).
- Four scripted presets: nominal round trip, mid-mission closure, reserve breach, stranded.

### Draggable mission timeline

- A bottom timeline shows leg color bands (outbound / science stop / return / emergency return), event ticks, the T+ clock, and play/pause controls; the mission card holds the ×1–×16 speed selector.
- Scrub to any minute: astronaut position, phase, resources, event log, and route states all re-derive for that T, synchronized in 3D and 2D. Dragging pauses playback; clicking an event tick seeks to it; `←`/`→` step ±1 minute.
- Scrubbing across events replays them deterministically (no double-applied losses), and scrubbing back restores the earlier state exactly.

### Returnable range

- A reverse-Dijkstra cost field spreads from the base, charging every edge in the real walking direction (climb asymmetry included) under the current closure mask.
- The boundary plus a faint fill render on the terrain in 3D and 2D, shrinking as remaining resources deplete and stepping inward the moment a battery loss or closure hits. The boundary is labeled simulated and honest to ±1–2 planning cells (20 m grid + alignment uncertainty).
- The app separates "**can I still get home right now**" (the range) from "**can the mission still finish**" (the abort policy). Both are stated plainly; neither is rendered as a success state.

### Plan A/B comparison

- Lock the current plan as Plan A, change inputs (site, strategy, resources, stop duration) to get Plan B, then compare: both routes render together, with Plan A as subdued dashed lines.
- A per-item delta table covers distance, duration, oxygen, battery, margins after return, and feasibility, with the input conditions of each plan labeled.

### Adjustable science stop duration

- The science stop length is adjustable in the mission card; changing it (like any other input) generates a new plan under a fresh request ID, so stale results never linger.

### 2D check view and transparency

- An undistorted 2D ortho view serves both as a verification view (routes, scale bar, north arrow, blocked areas) and as the automatic fallback when WebGL is unavailable.
- A sources & assumptions drawer lists the 6 source records, the registry of simulated assumptions (speeds, reserves, stop duration, thresholds), and the observed/derived/simulated classification. A "SIMULATED SCENARIO · REAL TERRAIN DATA" badge is always visible.
- The interface is English by default; Chinese is available via the `#CNZH` URL suffix.

## What is real and what is simulated

**Real (NASA):** terrain, imagery, science-site objectives, provenance and alignment records.

**Simulated (labeled everywhere):** the base, events, science stop duration, walking speeds and consumption rates, and resource units (abstract 0–100 budget points, never liters or watt-hours).

Route and resource estimates rest on documented simplifications (`sources.json` → assumptions). This is a research and educational prototype, **not validated astronaut navigation or life-support guidance**.

## Measured performance

All numbers are from recorded acceptance runs on Apple M4 (macOS arm64) in a real browser session (ANGLE Metal WebGL):

- Full round-trip plan (both strategies) on the real 256 × 256 grid: ~5–12 ms in the kernel; in-browser planning interactions measured 15.3–21.3 ms against the ≤ 1 s target.
- Full-grid returnable-range field: ≤ 50 ms per recompute (asserted by the test suite).
- First load ≈ 1.7 MB total (data package, JS gzip, texture) plus a one-off display-surface bake measured at 0.6–0.9 s in-browser (menu-bar laptop, single thread, yields to the event loop every 128 rows).
- Draw calls: 18 with the forward renderer, 32–37 once the post chain is active (it accumulates passes). Frame rate must be re-measured on the demo machine: the bloom chain disables itself when the first ~1.6 s of frames average below 30 fps, so a slow GPU degrades instead of stuttering.

## Testing and quality

- 58 automated tests: kernel search and budget invariants, loader validation, display mapping, simulation determinism and event semantics, returnable-field consistency with the forward search, and real-data performance gates.
- `npm run typecheck`, `npm run build`, and `npm run validate:data` all pass in CI-style local runs.

## Run it

Requires Node (tested with Node 24):

```bash
npm install
npm run dev            # development server
```

Other commands:

```bash
npm test               # 58 automated tests
npm run build          # production build
npm run validate:data  # verify data package schema and checksums
npm run demo           # CLI route-planning demo
```

## Documentation

- [docs/DEMO.md](docs/DEMO.md) — a short, repeatable demo script
- [docs/README.md](docs/README.md) — documentation index (Chinese)
- [docs/RESEARCH.md](docs/RESEARCH.md) — research and source limitations
- [docs/SPECIFICATION.md](docs/SPECIFICATION.md) — product and engineering contracts
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — phased implementation and acceptance records
- [docs/VISUAL-DIRECTION.md](docs/VISUAL-DIRECTION.md) — visual direction and art/science boundaries
- [docs/VISUAL-UPGRADE-PLAN.md](docs/VISUAL-UPGRADE-PLAN.md) — demo-video-oriented 3D look upgrade plan (proposal, not implemented)

Not implemented (documented future extensions in `docs/IMPLEMENTATION.md` §8): MEDA weather history, radiation models, multi-target itineraries, route smoothing, and an AI explanation assistant.

## Attribution and participation

The original concept names **Liang-Tzu**, Singapore Local Event. Account membership and submission status have not been verified. AI development assistance and dataset attribution must be documented in the eventual submission, per competition requirements.

Code is licensed under [MIT](LICENSE). External datasets and imagery retain their own terms and attribution requirements; the repository license does not relicense them.
