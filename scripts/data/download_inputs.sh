#!/usr/bin/env bash
# Download the raw inputs used by build_data_package.py (Phase 1, Mars Survival Guide).
# Run from the repository root. Files land in cache/ (git-ignored working data).
#
# Products (verified 2026-11-14):
#  1. Mars 2020 Science Investigation CTX DEM mosaic, 20 m/px (MRO / CTX)
#     PDS4 LID urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic v1.0
#     Citation: Mangold et al., 2021, Science, https://doi.org/10.1126/science.abl4051
#  2. Mars 2020 Science Investigation CTX ortho mosaic, ~5 m/px (windowed read only,
#     downloaded here in full for reproducibility of local processing)
#  3. HiRISE DTM DTEEC_045994_1985_046060_1985_U01 (MRO / HiRISE, Univ. of Arizona),
#     PDS3 dataset MRO-M-HIRISE-5-DTM-V1.0, 1 m/px, footprint covers the planning region.
set -euo pipefail

DEM_DIR="cache/mars2020_trn/CTX/ScienceInvestigationMaps_JPL"
HIRISE_DIR="cache/hirise_dtm/ESP_045994_1985_ESP_046060_1985"
mkdir -p "$DEM_DIR" "$HIRISE_DIR"

USGS="https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL"
HIRISE_PDS="https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_045900_045999/ESP_045994_1985_ESP_046060_1985"

# CTX DEM mosaic (20 m) + PDS4 label
curl -L --fail -o "$DEM_DIR/M20_JezeroCrater_CTXDEM_20m.tif" "$USGS/M20_JezeroCrater_CTXDEM_20m.tif"
curl -L --fail -o "$DEM_DIR/M20_JezeroCrater_CTXDEM_20m.xml" "$USGS/M20_JezeroCrater_CTXDEM_20m.xml"

# CTX ortho mosaic (~5 m) + PDS4 label (360 MB)
curl -L --fail -o "$DEM_DIR/M20_JezeroCrater_CTXortho_mosaic_5m.tif" "$USGS/M20_JezeroCrater_CTXortho_mosaic_5m.tif"
curl -L --fail -o "$DEM_DIR/M20_JezeroCrater_CTXortho_mosaic_5m.xml" "$USGS/M20_JezeroCrater_CTXortho_mosaic_5m.xml"

# HiRISE DTM (380 MB, PDS3 attached label inside the IMG)
curl -L --fail -o "$HIRISE_DIR/DTEEC_045994_1985_046060_1985_U01.IMG" \
  "$HIRISE_PDS/DTEEC_045994_1985_046060_1985_U01.IMG"

echo "Downloaded. SHA256 references are recorded by build_data_package.py in checksums.json."
