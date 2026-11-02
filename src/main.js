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
// Entry point: game loop, camera, input, HUD

import { Vec2, lexp, expSmooth, clamp, PIf } from './math.js';
import { Namer } from './namer.js';
import { Universe, UNIVERSE_RANGE } from './universe.js';
import { Autopilot } from './autopilot.js';
import { drawUniverse } from './renderer.js';

// ── Seed logic (MainActivity.kt randomSeed / dailySeed) ──────────────────────
const RANDOM_SEED_TYPE = 'Daily';  // Fixed | Daily | Evergreen
const FIXED_RANDOM_SEED = 5038n;   // BigInt to match Kotlin Long

function dailySeed() {
    // MainActivity.kt: year * 10000 + month * 100 + day
    // Java Calendar.MONTH is 0-indexed, matching JS Date.getMonth()
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
            // Evergreen: random long mod 10_000_000
            const r = BigInt(Math.floor(Math.random() * 10_000_000));
            return r < 0n ? -r : r;
        }
    }
}

// ── System designation (MainActivity.kt getSystemDesignation) ─────────────────
// Web port uses "WEB-XXXXX" instead of the Android dessert code
function getSystemDesignation(universe) {
    return `WEB-${Number(BigInt(universe.randomSeed) % 100_000n)}`;
}

// ── Camera constants (MainActivity.kt) ───────────────────────────────────────
const DEFAULT_CAMERA_ZOOM = 1.0;
const MIN_CAMERA_ZOOM = 250 / UNIVERSE_RANGE;  // 0.00125
const MAX_CAMERA_ZOOM = 5.0;

// ── Flight stick constants (MainActivity.kt) ──────────────────────────────────
// minRadius = 50dp, maxRadius = 100dp → in pixels, approximated as device pixels
const STICK_MIN_RADIUS = 50;
const STICK_MAX_RADIUS = 100;

// ── Bootstrap ────────────────────────────────────────────────────────────────
const canvas    = document.getElementById('gameCanvas');
const ctx       = canvas.getContext('2d');

const catalogEl    = document.getElementById('catalog');
const telemetryEl  = document.getElementById('telemetry');
const autopilotEl  = document.getElementById('autopilot-status');
const autoBtn      = document.getElementById('autoBtn');

// Build universe
const seed     = randomSeed();
const namer    = new Namer();
const universe = new Universe(namer, seed);
universe.initRandom();

// Set up autopilot
const autopilot = new Autopilot(universe.ship, universe);
universe.ship.autopilot = autopilot;
universe.add(autopilot);
autopilot.enabled = false;

// ── Camera state ──────────────────────────────────────────────────────────────
let cameraZoom   = DEFAULT_CAMERA_ZOOM;
let dynamicZoom  = false;   // enabled when autopilot is on (MainActivity.kt DYNAMIC_ZOOM)

// ── Flight stick state ────────────────────────────────────────────────────────
let stickActive = false;
let stickOrigin = Vec2.Zero;
let stickCurrent = Vec2.Zero;

// ── Resize handler ────────────────────────────────────────────────────────────
function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ── Pointer (mouse + touch) input ─────────────────────────────────────────────
// Mirrors FlightStick composable in MainActivity.kt
canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickActive  = true;
    stickOrigin  = new Vec2(e.clientX, e.clientY);
    stickCurrent = stickOrigin;
    canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
    if (!stickActive) return;
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
    // Mirrors FlightStick.onStickChanged in MainActivity.kt
    if (autopilot.enabled) return;  // autopilot owns the controls

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
        // inside minRadius: reorient only, no thrust
        ship.thrust = Vec2.Zero;
    } else {
        // lexp(minRadius, maxRadius, m) clamped to [0,1]
        const thrustMag = clamp(lexp(STICK_MIN_RADIUS, STICK_MAX_RADIUS, m), 0, 1);
        ship.thrust = Vec2.makeWithAngleMag(a, thrustMag);
    }
}

// ── AUTO button ───────────────────────────────────────────────────────────────
autoBtn.addEventListener('click', () => {
    autopilot.enabled = !autopilot.enabled;
    dynamicZoom = autopilot.enabled;    // MainActivity.kt: DYNAMIC_ZOOM = it.enabled
    if (!autopilot.enabled) {
        universe.ship.thrust = Vec2.Zero;
    }
    updateAutoBtnStyle();
});

function updateAutoBtnStyle() {
    autoBtn.style.background = autopilot.enabled ? '#4285F4' : 'transparent';
    autoBtn.style.color      = autopilot.enabled ? '#FFFFFF'  : '#B7B7FF';
}

// ── HUD update ────────────────────────────────────────────────────────────────
function updateHUD() {
    const ship    = universe.ship;
    const closest = universe.closestPlanet();
    const distToClosest = Math.max(0, closest.pos.minus(ship.pos).mag() - closest.radius);
    const explored = universe.planets.filter(p => p.explored);

    // Top-left: catalog (star + explored planets)
    // Mirrors Telemetry() Text in MainActivity.kt
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
    const fx = v.x >= 0 ? `+${Math.round(v.x)}` : `${Math.round(v.x)}`;
    const fy = v.y >= 0 ? `+${Math.round(v.y)}` : `${Math.round(v.y)}`;
    return `(${fx}, ${fy})`;
}

// ── Draw grid (Spaaaace() in MainActivity.kt) ─────────────────────────────────
function drawGrid(ctx, visibleRect, zoom) {
    let gridStep = 1000;
    // while gridStep * zoom < 32 pixels, multiply by 10
    while (gridStep * zoom < 32) gridStep *= 10;

    ctx.strokeStyle = '#292936'; // Colors.Eigengrau2
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

// ── Draw flight stick overlay (screen space) ──────────────────────────────────
function drawFlightStickOverlay(ctx) {
    if (!stickActive) return;
    const delta = stickCurrent.minus(stickOrigin);
    const mag   = delta.mag();
    const r     = Math.max(STICK_MIN_RADIUS, Math.min(STICK_MAX_RADIUS, mag));
    const a     = delta.angle();

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // screen space

    ctx.beginPath();
    ctx.arc(stickOrigin.x, stickOrigin.y, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth   = 2;
    if (mag < STICK_MIN_RADIUS) {
        ctx.setLineDash([1, 2]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // thrust line
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

// ── Main render loop ──────────────────────────────────────────────────────────
// Mirrors Spaaaace() composable + LaunchedEffect game loop in MainActivity.kt
let lastNanos = 0n;

function frame(timestamp) {
    // timestamp is DOMHighResTimeStamp in ms; convert to nanoseconds (BigInt)
    const nanos = BigInt(Math.round(timestamp * 1_000_000));

    // Step physics simulation
    universe.step(nanos);

    // ── Camera update (Spaaaace() in MainActivity.kt) ────────────────────────
    const ship    = universe.ship;
    const closest = universe.closestPlanet();
    const distToNearestSurf = Math.max(0, ship.pos.minus(closest.pos).mag() - closest.radius * 1.2);

    const targetZoom = dynamicZoom
        ? clamp(500 / distToNearestSurf, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM)
        : DEFAULT_CAMERA_ZOOM;

    cameraZoom = expSmooth(cameraZoom, targetZoom, universe.dt, 1.5);

    // Camera follows ship (cameraOffset = -ship.pos in world coordinates)
    const cameraOffset = (universe.follow ? universe.follow.pos : Vec2.Zero).times(-1);

    // ── Canvas clear ──────────────────────────────────────────────────────────
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16161D'; // Colors.Eigengrau
    ctx.fillRect(0, 0, W, H);

    // ── World-space transform ─────────────────────────────────────────────────
    // Camera: screen center = ship world pos
    // cameraZoom: world → screen pixels
    const cx = W / 2;
    const cy = H / 2;

    // Compute the visible world rectangle (mirrors visibleSpaceRectMeters in Spaaaace())
    const halfW = (W / 2) / cameraZoom;
    const halfH = (H / 2) / cameraZoom;
    const camCenter = cameraOffset.times(-1); // = ship.pos
    const visibleRect = {
        left:   camCenter.x - halfW,
        right:  camCenter.x + halfW,
        top:    camCenter.y - halfH,
        bottom: camCenter.y + halfH,
    };

    // Apply world transform: translate so ship is at canvas center
    ctx.setTransform(
        cameraZoom, 0, 0, cameraZoom,
        cx + cameraOffset.x * cameraZoom,
        cy + cameraOffset.y * cameraZoom
    );

    // Draw grid in world space
    drawGrid(ctx, visibleRect, cameraZoom);

    // Draw all universe elements
    drawUniverse(ctx, universe, cameraZoom);

    // ── Screen-space overlay ──────────────────────────────────────────────────
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawFlightStickOverlay(ctx);

    // ── HUD text (DOM elements) ───────────────────────────────────────────────
    updateHUD();

    requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

