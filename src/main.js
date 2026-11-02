// Copyright (C) 2023 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Port of com.android.egg.landroid.MainActivity.kt
// Entry point: game loop, camera, input, HUD, Pause menu, and Leaflet Universe Map integration

import { Vec2, lexp, expSmooth, clamp, PIf, PI2f } from './math.js';
import { Namer } from './namer.js';
import { Universe, UNIVERSE_RANGE, PLANET_ORBIT_MIN, PLANET_ORBIT_MAX } from './universe.js';
import { Autopilot } from './autopilot.js';
import { drawUniverse } from './renderer.js';
import {
    initUniverseMap,
    showUniverseMap,
    hideUniverseMap,
    fitEntireUniverse,
    updateMapPositions
} from './universe-map.js';

// ── Game State Machine ─────────────────────────────────────────────────────────
export const GameState = {
    PLAYING: 'PLAYING',
    PAUSED:  'PAUSED',
    MAP:     'MAP',
};

let currentState = GameState.PLAYING;

// ── Seed logic (MainActivity.kt randomSeed / dailySeed) ──────────────────────
const RANDOM_SEED_TYPE = 'Daily';  // Fixed | Daily | Evergreen
const FIXED_RANDOM_SEED = 5038n;   // BigInt to match Kotlin Long

function dailySeed() {
    const d = new Date();
    return BigInt(d.getFullYear()) * 10000n +
           BigInt(d.getMonth()) * 100n +
           BigInt(d.getDate());
}

function randomSeed() {
    switch (RANDOM_SEED_TYPE) {
        case 'Fixed':    return FIXED_RANDOM_SEED;
        case 'Daily':    return dailySeed();
        default: {
            const r = BigInt(Math.floor(Math.random() * 10_000_000));
            return r < 0n ? -r : r;
        }
    }
}

// ── System designation (MainActivity.kt getSystemDesignation) ─────────────────
function getSystemDesignation(u) {
    return `WEB-${Number(BigInt(u.randomSeed) % 100_000n)}`;
}

// ── Camera constants (MainActivity.kt) ───────────────────────────────────────
const DEFAULT_CAMERA_ZOOM = 1.0;
const MIN_CAMERA_ZOOM = 250 / UNIVERSE_RANGE;  // 0.00125
const MAX_CAMERA_ZOOM = 5.0;

// ── Flight stick constants (MainActivity.kt) ──────────────────────────────────
const STICK_MIN_RADIUS = 50;
const STICK_MAX_RADIUS = 100;

// ── DOM Elements ─────────────────────────────────────────────────────────────
const canvas           = document.getElementById('gameCanvas');
const ctx              = canvas.getContext('2d');

const catalogEl        = document.getElementById('catalog');
const telemetryEl      = document.getElementById('telemetry');
const autopilotEl      = document.getElementById('autopilot-status');
const autoBtn          = document.getElementById('autoBtn');
const hudMapBtn        = document.getElementById('hudMapBtn');
const hudPauseBtn      = document.getElementById('hudPauseBtn');

const pauseModal       = document.getElementById('pause-modal');
const pauseMetaEl      = document.getElementById('pause-meta');
const btnResume        = document.getElementById('btn-resume');
const btnViewMap       = document.getElementById('btn-view-map');
const btnRestart       = document.getElementById('btn-restart');

const btnReturnCockpit = document.getElementById('btn-return-cockpit');
const btnFitUniverse   = document.getElementById('btn-fit-universe');
const mapTitleDisplay  = document.getElementById('map-title-display');

// ── Build Universe ───────────────────────────────────────────────────────────
const seed     = randomSeed();
const namer    = new Namer();
const universe = new Universe(namer, seed);
universe.initRandom();
window.universe = universe;

// ── Autopilot ────────────────────────────────────────────────────────────────
const autopilot = new Autopilot(universe.ship, universe);
universe.ship.autopilot = autopilot;
universe.add(autopilot);
autopilot.enabled = false;

// ── Initialize Universe Map ──────────────────────────────────────────────────
initUniverseMap(universe, () => resumeGame());

// ── Camera state ──────────────────────────────────────────────────────────────
let cameraZoom   = DEFAULT_CAMERA_ZOOM;
let dynamicZoom  = false;

// ── Flight stick state ────────────────────────────────────────────────────────
let stickActive = false;
let stickOrigin = Vec2.Zero;
let stickCurrent = Vec2.Zero;

// ── Hi-DPI & Resize handler ───────────────────────────────────────────────────
let dpr = window.devicePixelRatio || 1;

function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
}
resize();
window.addEventListener('resize', resize);

// ── Pointer (mouse + touch) input ─────────────────────────────────────────────
canvas.addEventListener('pointerdown', (e) => {
    if (currentState !== GameState.PLAYING) return;
    e.preventDefault();
    stickActive  = true;
    stickOrigin  = new Vec2(e.clientX, e.clientY);
    stickCurrent = stickOrigin;
    canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    if (!stickActive || currentState !== GameState.PLAYING) return;
    e.preventDefault();
    stickCurrent = new Vec2(e.clientX, e.clientY);
    applyStick(stickCurrent.minus(stickOrigin));
});

canvas.addEventListener('pointerup',     releaseStick);
canvas.addEventListener('pointercancel', releaseStick);

function releaseStick(e) {
    stickActive = false;
    stickOrigin  = Vec2.Zero;
    stickCurrent = Vec2.Zero;
    applyStick(Vec2.Zero);
}

function applyStick(delta) {
    if (autopilot.enabled) return;

    const ship = universe.follow;
    if (!ship) return;

    if (delta.mag() === 0) {
        ship.thrust = Vec2.Zero;
        return;
    }

    const a = delta.angle();
    ship.angle = a;

    const m = delta.mag();
    if (m < STICK_MIN_RADIUS) {
        ship.thrust = Vec2.Zero;
    } else {
        const thrustMag = clamp(lexp(STICK_MIN_RADIUS, STICK_MAX_RADIUS, m), 0, 1);
        ship.thrust = Vec2.makeWithAngleMag(a, thrustMag);
    }
}

// ── Autopilot Toggle ─────────────────────────────────────────────────────────
autoBtn.addEventListener('click', () => {
    autopilot.enabled = !autopilot.enabled;
    dynamicZoom = autopilot.enabled;
    if (!autopilot.enabled) {
        universe.ship.thrust = Vec2.Zero;
    }
    updateAutoBtnStyle();
});

function updateAutoBtnStyle() {
    autoBtn.classList.toggle('active', autopilot.enabled);
}

// ── Game State Controls (Pause, Map, Restart, Resume) ────────────────────────
export function pauseGame() {
    if (currentState === GameState.MAP) {
        hideUniverseMap();
    }
    currentState = GameState.PAUSED;
    releaseStick();

    // Populate pause meta details
    const explored = universe.planets.filter(p => p.explored).length;
    const total = universe.planets.length;
    const designation = getSystemDesignation(universe);
    if (pauseMetaEl) {
        pauseMetaEl.innerHTML = `
            SYSTEM: ${universe.star.name} (${designation})<br>
            EXPLORATION PROGRESS: ${explored} / ${total} BODIES SURVEYED<br>
            SHIP STATUS: ${universe.ship.landing ? 'LANDED ON ' + universe.ship.landing.planet.name.toUpperCase() : 'ORBITING / IN-FLIGHT'}
        `;
    }
    if (pauseModal) pauseModal.classList.add('visible');
}

export function resumeGame() {
    if (currentState === GameState.MAP) {
        hideUniverseMap();
    }
    if (pauseModal) pauseModal.classList.remove('visible');

    currentState = GameState.PLAYING;
    // Reset simulation wallClockNanos so there is no time jump spike
    universe.wallClockNanos = 0n;
}

export function openMap() {
    if (pauseModal) pauseModal.classList.remove('visible');
    currentState = GameState.MAP;
    releaseStick();
    // Reset simulation wallClockNanos so there is no time jump spike
    universe.wallClockNanos = 0n;

    if (mapTitleDisplay) {
        mapTitleDisplay.textContent = `SYSTEM MAP // ${universe.star.name} (${getSystemDesignation(universe)})`;
    }
    showUniverseMap();
}

export function restartGame() {
    // 1. Remove landing constraint if currently landed
    if (universe.ship.landing) {
        universe.remove(universe.ship.landing);
        universe.ship.landing = null;
    }

    // 2. Reposition ship to starting orbit
    const rng = universe.rng;
    const shipOrbitAngle  = rng.nextFloat() * PI2f;
    const shipOrbitRadius = rng.nextFloatInRange(PLANET_ORBIT_MIN, PLANET_ORBIT_MAX);
    universe.ship.pos   = universe.star.pos.plus(Vec2.makeWithAngleMag(shipOrbitAngle, shipOrbitRadius));
    universe.ship.opos  = universe.ship.pos;
    universe.ship.angle = rng.nextFloat() * PI2f;
    universe.ship.velocity = Vec2.Zero;
    universe.ship.thrust   = Vec2.Zero;
    universe.ship.launchClock = universe.now;

    // 3. Clear trajectory track
    universe.track.length = 0;

    // 4. Reset autopilot & camera
    autopilot.enabled = false;
    dynamicZoom = false;
    cameraZoom = DEFAULT_CAMERA_ZOOM;
    updateAutoBtnStyle();

    // 5. Resume game
    resumeGame();
}

// ── Event Handlers ───────────────────────────────────────────────────────────
hudPauseBtn.addEventListener('click', () => pauseGame());
hudMapBtn.addEventListener('click',   () => openMap());

btnResume.addEventListener('click',   () => resumeGame());
btnViewMap.addEventListener('click',  () => openMap());
btnRestart.addEventListener('click',  () => restartGame());

btnReturnCockpit.addEventListener('click', () => resumeGame());
btnFitUniverse.addEventListener('click',   () => fitEntireUniverse());

// Keyboard shortcuts (ESC, M, P)
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        e.preventDefault();
        if (currentState === GameState.PLAYING) {
            pauseGame();
        } else {
            resumeGame();
        }
    } else if (e.key === 'm' || e.key === 'M') {
        if (currentState === GameState.PLAYING) {
            openMap();
        } else if (currentState === GameState.MAP) {
            resumeGame();
        }
    } else if (e.key === 'p' || e.key === 'P') {
        if (currentState === GameState.PLAYING) {
            pauseGame();
        } else if (currentState === GameState.PAUSED) {
            resumeGame();
        }
    }
});

// ── HUD update ────────────────────────────────────────────────────────────────
function updateHUD() {
    const ship    = universe.ship;
    const closest = universe.closestPlanet();
    const distToClosest = Math.max(0, closest.pos.minus(ship.pos).mag() - closest.radius);
    const explored = universe.planets.filter(p => p.explored);

    // Top-left: catalog
    const starLines = [
        `  STAR: ${universe.star.name} (${getSystemDesignation(universe)})`,
        ` CLASS: ${universe.star.cls}`,
        `RADIUS: ${Math.round(universe.star.radius)}`,
        `  MASS: ${universe.star.mass.toExponential(3)}`,
        `BODIES: ${explored.length} / ${universe.planets.length}`,
        '',
    ];
    const planetLines = explored.flatMap(p => [
        `  BODY: ${p.name}`,
        `  TYPE: ${capitalize(p.description)}`,
        `  ATMO: ${capitalize(p.atmosphere)}`,
        ` FAUNA: ${capitalize(p.fauna)}`,
        ` FLORA: ${capitalize(p.flora)}`,
        '',
    ]);
    catalogEl.textContent = [...starLines, ...planetLines].join('\n');

    // Bottom-left: ship telemetry
    const landingLine = ship.landing
        ? `LND: ${ship.landing.planet.name.toUpperCase()}\nJOB: ${ship.landing.text.toUpperCase()}`
        : (distToClosest < 10_000 ? `ALT: ${Math.round(distToClosest)}` : null);

    const telLines = [
        ...(landingLine ? [landingLine] : []),
        `THR: ${Math.round(ship.thrust.mag() * 100)}%`,
        `POS: ${fmtVec(ship.pos)}`,
        `VEL: ${Math.round(ship.velocity.mag())}`,
    ];
    telemetryEl.textContent = telLines.join('\n');

    // Autopilot status text
    autopilotEl.textContent = autopilot.telemetry;
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function fmtVec(v) {
    const pad = (n) => {
        const rounded = Math.round(n);
        const sign = rounded >= 0 ? '+' : '-';
        return `${sign}${Math.abs(rounded).toString().padStart(5, ' ')}`;
    };
    return `<${pad(v.x)}, ${pad(v.y)}>`;
}

// ── Draw grid (Spaaaace() in MainActivity.kt) ─────────────────────────────────
function drawGrid(ctx, visibleRect, zoom) {
    let gridStep = 1000;
    while (gridStep * zoom < 32) gridStep *= 10;

    ctx.strokeStyle = '#292936';
    const { left, right, top, bottom } = visibleRect;

    let x = Math.floor(left / gridStep) * gridStep;
    while (x < right) {
        const isMajor = (x % (gridStep * 10) === 0);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.lineWidth = (isMajor ? 3 : 1.5) / zoom;
        ctx.stroke();
        x += gridStep;
    }

    let y = Math.floor(top / gridStep) * gridStep;
    while (y < bottom) {
        const isMajor = (y % (gridStep * 10) === 0);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.lineWidth = (isMajor ? 3 : 1.5) / zoom;
        ctx.stroke();
        y += gridStep;
    }
}

// ── Draw flight stick overlay ─────────────────────────────────────────────────
function drawFlightStickOverlay(ctx) {
    if (!stickActive) return;
    const delta = stickCurrent.minus(stickOrigin);
    const mag   = delta.mag();
    const r     = Math.max(STICK_MIN_RADIUS, Math.min(STICK_MAX_RADIUS, mag));
    const a     = delta.angle();

    ctx.save();
    ctx.beginPath();
    ctx.arc(stickOrigin.x, stickOrigin.y, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth   = 2;
    if (mag < STICK_MIN_RADIUS) {
        ctx.setLineDash([1, 2]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const tipX = stickOrigin.x + Math.cos(a) * Math.min(STICK_MAX_RADIUS, mag);
    const tipY = stickOrigin.y + Math.sin(a) * Math.min(STICK_MAX_RADIUS, mag);
    ctx.beginPath();
    ctx.moveTo(stickOrigin.x, stickOrigin.y);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.restore();
}

// ── Main Render Loop ──────────────────────────────────────────────────────────
function frame(timestamp) {
    // Step physics simulation when active in cockpit OR in live map view
    if (currentState === GameState.PLAYING || currentState === GameState.MAP) {
        const nanos = BigInt(Math.round(timestamp * 1_000_000));
        universe.step(nanos);
    }

    // Update live orbital marker positions on the Leaflet map in real time
    if (currentState === GameState.MAP) {
        updateMapPositions();
    }

    // Only render canvas and update HUD if not completely covered by Map View
    if (currentState !== GameState.MAP) {
        const ship = universe.ship;
        const closest = universe.closestPlanet();
        const distToNearestSurf = Math.max(0, ship.pos.minus(closest.pos).mag() - closest.radius * 1.2);

        const targetZoom = dynamicZoom
            ? clamp(500 / distToNearestSurf, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM)
            : DEFAULT_CAMERA_ZOOM;

        cameraZoom = expSmooth(cameraZoom, targetZoom, universe.dt, 1.5);

        const cameraOffset = (universe.follow ? universe.follow.pos : Vec2.Zero).times(-1);

        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#16161D';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const cx = w / 2;
        const cy = h / 2;

        const halfW = (w / 2) / cameraZoom;
        const halfH = (h / 2) / cameraZoom;
        const camCenter = cameraOffset.times(-1);
        const visibleRect = {
            left:   camCenter.x - halfW,
            right:  camCenter.x + halfW,
            top:    camCenter.y - halfH,
            bottom: camCenter.y + halfH,
        };

        ctx.setTransform(
            cameraZoom * dpr, 0, 0, cameraZoom * dpr,
            (cx + cameraOffset.x * cameraZoom) * dpr,
            (cy + cameraOffset.y * cameraZoom) * dpr
        );

        drawGrid(ctx, visibleRect, cameraZoom);
        drawUniverse(ctx, universe, cameraZoom, visibleRect);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawFlightStickOverlay(ctx);

        updateHUD();
    }

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
