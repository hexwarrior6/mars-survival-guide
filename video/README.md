# Mars Survival Guide — 31-second film

A 31-second, 1920 × 1080, 30 fps Remotion film with frame-driven Three.js scenes, English kinetic titles and one continuous original electronic score (140 BPM, A minor). No screen recording or paid generation service is required.

## Reproduce

Requires the repository's Node.js environment plus `ffmpeg` and `ffprobe` on PATH. From this directory:

```sh
npm ci
npm run assets
npm run score
npm run studio
npm run render
```

The render command finalizes AAC padding to an exact 31.000-second container without re-encoding the H.264 pictures. The MP4 is written to `deliverables/mars-survival-guide-31s-unified-score.mp4`. Generated assets and render outputs are ignored by Git. Asset preparation uses the parent application's data loaders, route planner and mission simulation; run it from this repository rather than copying this folder alone.

## Continuous opening

The first 7.77 seconds reuse the application's continuous `approachPose`, `approachPlaybackRate`, geographic orientation, regional geometry and globe/atmosphere shaders. Camera movement is sampled deterministically from that shared path. During descent, the local mission mesh samples the same regional photograph at matching projected coordinates and stays neutral grey, so no warm rectangular tile appears inside the regional map.

On arrival, a bright screen-left-to-right scan reveals the final clay-toned mission material. The unrevealed side stays grey while the surround fades away; the display block and mission markers appear after the sweep. Lighting and camera framing match the following montage.

`Film31.tsx` retimes the 35-second authored edit uniformly to 930 integer frames. The soundtrack is authored directly as one continuous 31-second cue: the same A-minor motif, chord cycle, synths, bass and 140 BPM beat grid run from the opening to the ending. Arrangement density increases gradually; camera-scale changes do not splice or restart the music. It is normalized to -16 LUFS with a -1.5 dBTP ceiling before the composition gain. Earlier 30- and 35-second MP4 exports remain available separately.

The regional apron outside the measured mission DEM is an artistic transition to planetary curvature, not a measured regional DEM. Orbital range readouts use kilometres.

## Source and evidence boundaries

- `scripts/prepare.ts` loads the frozen Jezero NASA terrain package, plans the SITE-B round trip, triggers the existing closure at simulated minute 130 and samples the deterministic mission state for all video frames. It aborts if the selected emergency return cannot reach base with reserves intact.
- The terrain mesh uses the published 256 × 256 DEM and original CTX ortho image. Horizontal dimensions and routes preserve the package coordinates. Vertical relief is exaggerated 4.5×, matching the application. Lighting, markers, route thickness and the cut-away block are display treatments.
- Mars uses the project's Viking MDIM texture; full source attribution remains in `../public/data/mars/README.md` and `../public/data/jezero/sources.json`.
- The control-console insert is the existing real application screenshot `../docs/visuals/current-overview.png`. Other shots are purpose-built film views of the same terrain and computed mission, not a recording of live user interaction.
- Mission time is compressed for the film. O₂ and power are abstract 0–100 simulation budget units. The low-altitude route camera follows the simulated position and artistic terrain relief, not measured astronaut footage or validated navigation.
- `scripts/score.mjs` synthesizes all music and effects deterministically; no external music, recordings, voice or sample library is used.

## Edit

- `src/Film31.tsx`: active 31-second master timeline, integer-frame retiming and soundtrack.
- `src/Film35.tsx`: earlier 35-second master.
- `src/Opening.tsx`: continuous orbital approach, regional surround and boundary lock.
- `src/Film.tsx`: scene timing, titles, HUD, console insert, soundtrack and end card.
- `src/Scene.tsx`: frame-driven cameras, globe, terrain, route reveal and markers.
- `scripts/prepare.ts`: verified mission data and local asset preparation.
- `scripts/score.mjs`: original score and edit-aligned sound effects.
- `scripts/finalize.mjs`: exact-duration output and media metadata verification.

The film is separate from the application build and does not modify application behavior.

## Version control

The film source is archived on the `film-archive` branch of the parent repository
instead of `main`, keeping the application branch free of film source. Generated
assets, deliverables and dependencies stay untracked and are reproducible with the
commands above. Checking out `main` removes this working copy (the files are tracked
only on the archive branch), so restore it after switching back:

```sh
git restore --source=film-archive --worktree -- video/
```
