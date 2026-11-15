# Mars Survival Guide: Martian Map

Live application: https://mars-survival-guide-green.vercel.app/

Submitted demonstration: https://youtu.be/41C24oOkQJE

Submitted for judging: 2026-11-15 23:49 Singapore time, confirmed by the competition website. The demonstration is approximately 35 seconds and exceeds the stated 30-second limit; this confirmation does not establish Global Award eligibility.

## Project summary

How far can an astronaut explore and still get home? Mars Survival Guide turns real NASA terrain into an interactive Marswalk planning console. Explore Jezero Crater in 3D, choose a science objective, compare round-trip routes, and see how time, terrain and resource reserves constrain the mission. Replay a simulated battery loss or blocked area and watch the return plan change. Every observation, calculation and simulated assumption is identified, making the trade-offs visible and open to inspection.

## Project description

A compelling science destination is only useful if the crew can reach it and return. Our prototype brings the science objective, terrain and return budget into one view. It addresses Interplanetary Survival Guide: Martian Map through a focused Jezero western-delta scenario rather than an unverified planet-wide navigation system.

The experience starts on a Viking-derived Mars globe and approaches a 60 km CTX regional image before arriving at a 5.12 km terrain sandbox. Users select one of three landform-anchored science destinations and compare shortest and terrain-aware round trips. The planner uses actual DEM elevations and slopes; ascent changes travel time, impassable cells block paths, and the return leg is calculated independently. A feasibility check includes outbound travel, science-stop time, return travel and a fixed resource reserve.

The console supports Plan A/B comparisons, an adjustable science-stop duration, a computed returnable-range overlay, and a draggable mission timeline. Four deterministic scenarios demonstrate a normal mission, an area closure, a reserve breach and a stranded outcome. Battery loss and closures trigger a return calculation from the astronaut's current simulated position. Scrubbing back and forth reconstructs the same state without applying events twice. A 2D orthophoto view provides an independent visual check and a WebGL fallback.

The intended benefit is educational and exploratory: users can see why a destination becomes infeasible, what a terrain-aware route changes, and why getting back to base differs from preserving the required reserve. We do not claim operational validation or quantified safety improvements.

Built with TypeScript, React, Three.js / React Three Fiber, Vite and a local A*/Dijkstra planning kernel. Preprocessed data ships with the application; no API key, account, database or live NASA service is required to try it.

## NASA data and how it affects the solution

- **MRO CTX Mars 2020 DEM mosaic, 20 m/px:** the actual elevation input to the 256 × 256 planning grid. Derived slopes and ascent costs affect passability, travel time, routing and the returnable range. Product: `M20_JezeroCrater_CTXDEM_20m.tif`.
- **MRO CTX orthophoto mosaic, approximately 5 m/px:** provides aligned terrain imagery and the larger regional context. The 2D check view uses the ungraded orthophoto. Product: `M20_JezeroCrater_CTXortho_mosaic_5m.tif`.
- **MRO HiRISE DTM:** independently cross-checks the CTX elevations and alignment; it is not the route-planning grid. Product: `DTEEC_045994_1985_046060_1985_U01`.
- **Mars 2020 / Perseverance mission documentation and JPL science reporting:** support the delta science objectives and the rationale for investigating sedimentary landforms. Site positions are landform anchors with 50–200 m uncertainty, not exact official sample coordinates.
- **Viking MDIM 2.1 colorized global mosaic:** supplies the opening globe's visual context. It does not affect route calculations.

The application integrates MRO measurements, Mars 2020 science context and Viking visual context. These roles are distinct: not every source is a numerical planning input. NASA data is packaged for reliable offline-style use rather than requested live. The data manifest includes product IDs, provenance, processing notes, checksums and alignment limitations.

## References and credits

1. NASA challenge: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/
2. CTX DEM and orthophoto release: https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic
3. Mangold et al. (2021), Science: https://doi.org/10.1126/science.abl4051
4. HiRISE DTM archive: https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_045900_045999/ESP_045994_1985_ESP_046060_1985/
5. NASA Jezero landing-site context: https://mars.nasa.gov/mars2020/mission/landing-site/
6. JPL, Perseverance Investigates Geologically Rich Mars Terrain: https://www.jpl.nasa.gov/news/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/
7. HiRISE Depositional Fan caption: https://www.uahirise.org/PSP_003798_1985
8. Viking global mosaic: https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m
9. Downloaded globe-image source: https://commons.wikimedia.org/wiki/File:Mars_Viking_MDIM21_ClrMosaic_1km.jpg
10. Technology: https://react.dev/ ; https://threejs.org/ ; https://r3f.docs.pmnd.rs/ ; https://vite.dev/ ; https://www.typescriptlang.org/ ; https://vitest.dev/
11. Three.js workflow skills: https://github.com/CloudAI-X/threejs-skills

CTX credits: Mangold et al. / NASA / JPL-Caltech / USGS. HiRISE credits: NASA / JPL-Caltech / University of Arizona. Viking imagery: NASA / JPL / USGS; the downloaded derivative is identified as public domain. Code is MIT-licensed; external datasets retain their own terms. Exact per-product terms and processing details are in `public/data/jezero/sources.json` and `public/data/mars/README.md`.

## AI use disclosure

AI coding agents assisted with research, implementation planning, data-processing scripts, application code, interface and 3D rendering work, automated tests, debugging, documentation and deployment preparation. Codex was used in the project workflow. AI image generation was used for visual concept images in `docs/visuals/stage-03.png`, `stage-04.png` and `stage-05.png`; these are explicitly labeled concept art, not screenshots or scientific observations. Community Three.js skills supported the development workflow.

The project does not contain a runtime language-model planning agent. Route searches, budgets, event handling and replay are deterministic TypeScript calculations. AI-generated prose or artwork is not treated as NASA evidence. Contributions and checks are documented through source provenance, tests and the Git history; we do not claim a measured percentage of AI or human authorship.

## Limitations

This is a research and education prototype, not validated astronaut navigation or life-support guidance. The base, incidents, walking model, science-stop time and abstract 0–100 resource budgets are simulated assumptions. The 20 m grid cannot resolve small hazards. Site anchors carry 50–200 m uncertainty. The published alignment report records a roughly 93 m north/south HiRISE registration offset. Artistic strata, globe normal-map relief, atmosphere and the regional transition apron are display treatments, not measured geology or regional topography. MEDA weather, radiation prediction, multi-target itineraries and a runtime AI assistant are not implemented.
