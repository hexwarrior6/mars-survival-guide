# 🔴 Mars Survival Guide: Martian Map
> **NASA International Space Apps Challenge 2026**  
> **Challenge**: *Interplanetary Survival Guide: Martian Map*  
> **Team**: Liang-Tzu (Singapore Local Event)  
> **Live Demo**: *[Deployment URL]*

---

## 🛰️ 1. Project Overview

When the first astronauts set foot on the surface of Mars, they will face unprecedented environmental extremes: unmapped terrain slopes, catastrophic dust storms, cosmic radiation, and strict physiological life-support limits (oxygen and suit battery).

Unlike existing global-scale viewers (e.g., NASA Mars Trek), **Mars Survival Guide** is an interactive, tactical **Marswalk Survival HUD & AI Route Planning Console** tailored for astronauts on Extravehicular Activities (EVA) and Ground Mission Control. It aggregates multiple layers of NASA Mars mission data to deliver real-time risk assessment, hazard avoidance, and optimal science waypoint navigation.

---

## ⚡ 2. Key Features

- **Interactive 2.5D Jezero Crater Topography**: High-fidelity elevation contours, slope-gradient hazards, and real-time waypoint tracking based on Mars 2020 Perseverance exploration zones.
- **Multi-Layer NASA Hazard Overlays**:
  - 🌪️ **Atmospheric & Dust Storm Alerts**: Dynamic simulation of dust activity based on MEDA environmental telemetry.
  - ☢️ **Surface Radiation Field**: Micro-sievert flux heatmaps derived from MSL RAD surface measurements.
  - 🏔️ **Slope & Traverse Risk**: Automatic terrain slope safety grading (safe / steep / impassable cliff).
- **AI Marswalk Route Optimization**:
  - Real-time cost-weighted pathfinding algorithm balancing distance, terrain roughness, radiation exposure, and oxygen/power consumption.
  - Emergency Safe Abort Path generation under sudden dust or battery crisis.
- **Astronaut Life-Support Telemetry HUD**:
  - Real-time oxygen depletion rate, suit battery reserve, distance-to-home monitoring, and 20% safe-return threshold warning.
- **Scientific Sampling Catalog**:
  - Curated high-priority geological sampling sites with authentic NASA Mars imagery, mineral spectral tags (CRISM/PIXL), and scientific objectives.

---

## 📊 3. NASA Data & Tools Integration

Mars Survival Guide strictly adheres to NASA Space Apps Challenge data requirements by integrating authentic data from:
1. **[NASA JPL Mars Trek Data Portal](https://trek.nasa.gov/mars/)**: High-resolution digital elevation models (DEM) and MOLA topography of Jezero Crater.
2. **[NASA Mars 2020 Perseverance Rover Science Archive](https://mars.nasa.gov/mars2020/multimedia/raw-images/)**: Actual landing site coordinates (Octavia E. Butler Landing), traverse waypoints, and raw geological camera imagery.
3. **[NASA MSL Radiation Assessment Detector (RAD)](https://pds-atmospheres.nmsu.edu/)**: Ground-level cosmic and solar particle radiation flux benchmarks.
4. **[NASA MEDA (Mars Environmental Dynamics Analyzer)](https://mars.nasa.gov/msl/spacecraft/instruments/rad/)**: Atmospheric pressure, thermal fluctuations, and dust opacity models.

---

## 🛠️ 4. Tech Stack & Architecture

- **Frontend Core**: Modern Web Standards / HTML5 Canvas / Tailwind CSS / Lucide Icons
- **Mapping & Visualization**: 2.5D Vector Surface Engine with interactive multi-layer toggling
- **Pathfinding Engine**: Weighted A* heuristic solver factoring elevation delta and hazard weights
- **Deployment**: Zero-dependency static architecture ready for instant Vercel / GitHub Pages hosting

---

## 🚀 5. Quick Start

No complex environment setup required. Simply clone and run:

```bash
git clone https://github.com/hexwarrior6/mars-survival-guide.git
cd mars-survival-guide

# Open directly or serve with any static HTTP server
npx serve .
