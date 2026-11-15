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

## Role in the app

Display context only. The globe is the opening "from Mars" stage; the Jezero
marker is positioned from `public/data/jezero/region.json` (`boundsLatLon`), not
from this image. Nothing here feeds routing, timing, resources or any landform
anchor, and the 2D plan view never uses it.

The planning package itself remains `public/data/jezero/`; this folder is not
part of its checksum set, so `npm run validate:data` is unaffected.
