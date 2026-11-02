# Landroid (Web Port)

A pure HTML5 Canvas + vanilla JavaScript port of the AOSP Android Easter Egg "Landroid" space exploration game from `frameworks/base/packages/EasterEgg` (android17-release branch).

## About
This is an exact, faithful port of the space exploration simulator built by Dan Sandler for the Android Easter Egg. It implements:
- **XorWow RNG & Daily Seeds**: Procedural generation producing identical universe structures, star classes, planet parameters, and names for matching seeds.
- **Keplerian Orbital Mechanics & N-Body Gravity**: 2D position-based dynamics with gravitational fields, atmospheric landing constraints, and thruster physics.
- **Autopilot State Machine**: Autonomous exploration targeting, orbital approach deceleration, and sightseeing/blast-off routines.
- **Pure Canvas 2D Rendering**: Real-time rendering with high-DPI scaling (`devicePixelRatio`), smooth solar flare coronas, and custom planet contour textures.

## Running
Serve via any local static HTTP server:
```bash
# Python 3
python -m http.server 8080

# Or Node.js (e.g. npx serve)
npx serve .
```
Then open `http://localhost:8080` in your web browser.

## Controls
- **Click / Touch & Drag**: Virtual flight stick controlling ship heading and thruster magnitude.
- **AUTO Button**: Toggle autonomous autopilot navigation.
- **Camera**: Dynamically zooms when near bodies or exploring.

## License & Attribution
Original source code Copyright (C) 2023–2026 The Android Open Source Project.  
Licensed under the Apache License, Version 2.0. See original source headers for full notice.
No Android or Google logos are used as branding.
