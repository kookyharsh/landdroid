# Landroid (Web Port) & Universe Map

A pure HTML5 Canvas + vanilla JavaScript port of the AOSP Android Easter Egg "Landroid" space exploration game from `frameworks/base/packages/EasterEgg` (android17-release branch), unified with an interactive Google-Maps-style procedural universe viewer powered by Leaflet.js.

## About
This project is an exact, faithful port and enhancement of the space exploration simulator built by Dan Sandler for the Android Easter Egg. It implements:
- **XorWow RNG & Daily Seeds**: Procedural generation producing identical universe structures, star classes, planet parameters, and names for matching seeds.
- **Keplerian Orbital Mechanics & N-Body Gravity**: 2D position-based dynamics with gravitational fields, atmospheric landing constraints, and thruster physics.
- **Autopilot State Machine**: Autonomous exploration targeting, orbital approach deceleration, and sightseeing/blast-off routines.
- **High-Performance Canvas 2D Rendering**: Real-time rendering with high-DPI scaling (`devicePixelRatio`), smooth solar flare coronas, and viewport-boundary geometry culling maintaining a steady 60 FPS even near dense celestial bodies.
- **Interactive Google-Maps-Style Universe Map**: Full-universe interactive map (`L.CRS.Simple`) with procedural Cartesian coordinate tiles, orbital trajectories, solar corona markers, detailed planet survey sheets, live spacecraft position & track trail, and quick-jump navigation.

## Running
Serve via any local static HTTP server:
```bash
# Python 3
python -m http.server 8080

# Or Node.js (e.g. npx serve or Live Server)
npx serve .
```
Then open `http://localhost:8080` (or `http://127.0.0.1:5500` if using VS Code Live Server) in your web browser.

## Flight & Cockpit Controls
- **Click / Touch & Drag**: Virtual flight stick controlling ship heading and thruster magnitude.
- **AUTO Button**: Toggle autonomous autopilot navigation.
- **[ 🗺 MAP ] Button / Press `M`**: Open the interactive full-universe map overlay.
- **[ ⏸ ] Button / Press `ESC` / `P`**: Open the in-game Pause Menu with options to Resume, View Universe Map, or Restart Mission.

## Universe Map Features
- **Smooth Panning & Zooming**: Seamlessly zoom from full-system scale (400,000m span) down to meters-level close-ups.
- **Live Spacecraft Tracker**: Real-time position marker, heading angle, telemetry readout, and historical flight trail.
- **Interactive Celestial Data**: Click any planet or the central star to inspect physical radius, mass, orbital speed, atmosphere, flora, fauna, and exploration status.
- **Target & Quick Jump**: Jump selector dropdown to immediately focus on any celestial body or your spacecraft.
- **Return to Cockpit**: Click `[ 🚀 RETURN TO COCKPIT ]` or press `ESC` at any time to resume flying without losing position or momentum.

## License & Attribution
Original source code Copyright (C) 2023–2026 The Android Open Source Project.  
Licensed under the Apache License, Version 2.0. See original source headers for full notice.  
No Android or Google logos are used as branding.
