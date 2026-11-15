# Mars globe (opening stage)

`viking_mdim21_color_3840.jpg` — 3840 × 1920 equirectangular JPEG, derived for this
project from the **Mars Viking MDIM 2.1 Colorized Global Mosaic** (NASA / JPL /
USGS), downsampled from the 1 km/px release. (`viking_mdim21_color_2048.jpg` is
the earlier 2048-wide copy and is kept for reference.)

- **Source product:** Mars Viking MDIM 2.1 ClrMosaic 1 km (USGS Astrogeology;
  reduced from the 231 m/px colorized MDIM 2.1 mosaic).
  <https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m>
- **File used:** `Mars Viking MDIM21 ClrMosaic 1km.jpg`, Wikimedia Commons,
  public domain (work of the U.S. federal government), retrieved 2026-11-15.
  <https://commons.wikimedia.org/wiki/File:Mars_Viking_MDIM21_ClrMosaic_1km.jpg>
- **Processing:** resized to 3840 × 1920 with Lanczos, no colour grading,
  reprojection or feature retouching. The 2048-wide copy was resized the same way.

## Globe normal map

`mars_normal_1024.png` — 1024 × 512 tangent-space normal map derived from the
luminance gradient of the same globe image (1.1 px blur, scale 3.2). It adds
micro-relief shading to the globe; it is **artistic display detail**, not a
measured global DEM, and is never used for any computation.

## Regional LOD (Jezero)

`jezero_region_60km.jpg` — 2048 × 2048, colourised with the sandbox's own ramp.

- **Source:** the same `M20_JezeroCrater_CTXortho_mosaic_5m.tif` used to build
  `public/data/jezero/` (CTX ortho mosaic ~5 m/px, NASA/JPL/USGS).
- **Crop:** 60 × 60 km centred 6.1 km east of the 5.12 km package centre (the
  crop is shifted east so it stays inside the published mosaic); the package
  centre sits 6.1 km west of the crop centre, which is why the decal is offset
  by +6.1 km in world X.
- **Processing:** averaged to 2048² (29 m/px), then the same luma stretch / colour
  ramp as `src/ui/terrainLook.ts`. No generated detail.

## Role in the app

Display context only. The globe is the opening "from Mars" stage; the Jezero
marker is positioned from `public/data/jezero/region.json` (`boundsLatLon`), not
from this image. Nothing here feeds routing, timing, resources or any landform
anchor, and the 2D plan view never uses it.

The planning package itself remains `public/data/jezero/`; this folder is not
part of its checksum set, so `npm run validate:data` is unaffected.

## Continuous approach geometry

The regional image is mapped to a persistent, opaque 60 km surround with an
opening at the local DEM's outer cell centres (±2550 m for this package).
The mission DEM remains at its final display height throughout the camera
approach. All four regional seams sample the measured DEM boundary; a fixed
3 km display-only apron outside the package joins those heights to Mars
curvature. This apron is an artistic continuity treatment, not measured
regional elevation. Neither surface changes height with camera range. The regional image
gently resolves on approach, darkens near the mission, and fades away during
the arrival boundary-lock effect. It is hidden in the stable mission view,
including skipped introductions and reduced-motion mode. The regional UVs retain the
+6.1 km crop offset and north-up orientation.

The opening camera leg uses 2× playback, easing back to normal speed before the
final approach. The global display shader reduces the former saturation/brightness
boost and gradually blends the colourized Viking image toward the CTX display's
warm-grey palette between 1500 and 100 km camera range. This is display grading,
not measured surface colour; source image files and scientific data are unchanged.
