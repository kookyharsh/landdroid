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

// Port of com.android.egg.landroid.VisibleUniverse.kt
// All drawing functions translate directly from Compose DrawScope to Canvas 2D.

import { Vec2, PI2f, lerp } from './math.js';
import {
    GRAVITATION, SPACECRAFT_MASS,
    SIMPLE_TRACK_DRAWING, Star, Spark, Planet, Landing, TRACK_LENGTH
} from './universe.js';
import {
    spaceshipPath, spaceshipLegs, thrustPath,
    createStar, createPolygon, planetTextures, planetTextureSize
} from './assets.js';

// ── Constants (VisibleUniverse.kt) ───────────────────────────────────────────
export const DRAW_ORBITS_FLAG              = true;
export const DRAW_GRAVITATIONAL_FIELDS_FLAG = true;
export const DRAW_STAR_GRAVITATIONAL_FIELDS_FLAG = true;
export const STAR_POINTS = 31; // Build.VERSION.SDK_INT → 31 for web

// Colors (Colors.kt)
const Colors = {
    Eigengrau:  '#16161D',
    Eigengrau2: '#292936',
    Eigengrau3: '#3C3C4F',
    Eigengrau4: '#A7A7CA',
    Console:    '#B7B7FF',
    Track:      '#34A853',
    Flag:       '#C6FF00',
    Autopilot:  '#4285F4',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse an rgb/rgba/hex string and return an rgba string with the given alpha multiplied in.
 * Used to replicate Compose's color.copy(alpha=...).
 */
function withAlpha(colorStr, alpha) {
    // If already rgba(...), extract components
    let m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (m) {
        const a = m[4] !== undefined ? parseFloat(m[4]) * alpha : alpha;
        return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
    }
    // hex (#rrggbb or #rgb)
    let hex = colorStr.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ── Main draw entry point ─────────────────────────────────────────────────────

/**
 * Test whether a stroked circle ring intersects an axis-aligned bounding box.
 * Returns false if the rect is completely outside the circle OR completely inside the hole.
 */
export function circleIntersectsRect(center, radius, strokeWidth, rect) {
    if (!rect) return true;
    // Closest point on rect to center
    const clampedX = Math.max(rect.left, Math.min(rect.right, center.x));
    const clampedY = Math.max(rect.top, Math.min(rect.bottom, center.y));
    const dxMin = clampedX - center.x;
    const dyMin = clampedY - center.y;
    const rOuter = radius + strokeWidth;
    if (dxMin * dxMin + dyMin * dyMin > rOuter * rOuter) {
        return false; // Rect is entirely outside the circle
    }

    // Farthest point on rect to center (always one of the 4 corners)
    const maxDx = Math.max(Math.abs(rect.left - center.x), Math.abs(rect.right - center.x));
    const maxDy = Math.max(Math.abs(rect.top - center.y), Math.abs(rect.bottom - center.y));
    const rInner = Math.max(0, radius - strokeWidth);
    if (maxDx * maxDx + maxDy * maxDy < rInner * rInner) {
        return false; // Rect is entirely inside the hole of the ring
    }

    return true;
}

/**
 * Draw the complete universe. Called with canvas ctx already in world-space coordinates
 * (translated + scaled by camera). zoom is the current camera zoom factor.
 *
 * Drawing order mirrors VisibleUniverse.kt drawUniverse():
 *   1. Landing flags (constraints)
 *   2. Container (ringfence)
 *   3. Star
 *   4. Sparks + Planets (entities, star skipped)
 *   5. Autopilot overlay
 *   6. Spacecraft (track first, then ship body)
 */
export function drawUniverse(ctx, universe, zoom, visibleRect = null) {
    // 1. Constraints: Landing flags and Container
    for (const c of universe.constraints) {
        if (c instanceof Landing) {
            drawLanding(ctx, c, zoom);
        } else {
            // Container (ringfence)
            drawContainer(ctx, c, zoom, visibleRect);
        }
    }

    // 2. Star
    drawStar(ctx, universe.star, universe.now, zoom, visibleRect);

    // 3. Entities: Sparks and Planets (star is skipped)
    for (const entity of universe.entities) {
        if (entity === universe.star) continue;
        if (entity instanceof Spark) {
            drawSpark(ctx, entity, zoom);
        } else if (entity instanceof Planet) {
            drawPlanet(ctx, entity, universe, zoom, visibleRect);
        }
        // Spacecraft, Autopilot: drawn separately below
    }

    // 4. Autopilot overlay
    if (universe.ship.autopilot) {
        drawAutopilot(ctx, universe.ship.autopilot, universe, zoom);
    }

    // 5. Spacecraft (track then ship)
    drawSpacecraft(ctx, universe.ship, zoom);
}

// ── drawContainer ─────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawContainer()
export function drawContainer(ctx, container, zoom, visibleRect = null) {
    if (visibleRect && !circleIntersectsRect(Vec2.Zero, container.radius, 1 / zoom, visibleRect)) {
        return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, container.radius, 0, PI2f);
    ctx.strokeStyle = '#800000';
    ctx.lineWidth   = 1 / zoom;
    ctx.setLineDash([8 / zoom, 8 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

// ── drawGravitationalField ────────────────────────────────────────────────────
// VisibleUniverse.kt: drawGravitationalField()
export function drawGravitationalField(ctx, planet, now, zoom, visibleRect = null) {
    const rings = 10;
    for (let i = 0; i < rings; i++) {
        const force = lerp(2000, 0.01, (i - (now % 1)) / rings);
        const r     = Math.sqrt(GRAVITATION * planet.mass * SPACECRAFT_MASS / force);
        if (visibleRect && !circleIntersectsRect(planet.pos, r, 2 / zoom, visibleRect)) {
            continue;
        }
        const alpha = lerp(0.75, 0.1, i / rings);
        ctx.beginPath();
        ctx.arc(planet.pos.x, planet.pos.y, r, 0, PI2f);
        ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
        ctx.lineWidth   = 2 / zoom;
        ctx.stroke();
    }
}

// ── drawPlanet ────────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawPlanet()
export function drawPlanet(ctx, planet, universe, zoom, visibleRect = null) {
    const drawColor = planet.explored ? planet.color : Colors.Eigengrau4;

    // Orbit ring
    if (DRAW_ORBITS_FLAG) {
        const orbitR = planet.pos.distance(planet.orbitCenter);
        if (!visibleRect || circleIntersectsRect(planet.orbitCenter, orbitR, 1 / zoom, visibleRect)) {
            ctx.beginPath();
            ctx.arc(planet.orbitCenter.x, planet.orbitCenter.y, orbitR, 0, PI2f);
            ctx.strokeStyle = Colors.Eigengrau3;
            ctx.lineWidth   = 1 / zoom;
            ctx.stroke();
        }
    }

    // Gravitational field rings
    if (DRAW_GRAVITATIONAL_FIELDS_FLAG) {
        drawGravitationalField(ctx, planet, universe.now, zoom, visibleRect);
    }

    ctx.save();
    ctx.translate(planet.pos.x, planet.pos.y);

    // Background fill (hide things behind planet)
    ctx.beginPath();
    ctx.arc(0, 0, planet.radius, 0, PI2f);
    ctx.fillStyle = Colors.Eigengrau;
    ctx.fill();

    // Planet texture (explored + close enough + zoomed in enough)
    if (
        planet.explored &&
        zoom > 0.05 &&
        planet.pos.distance(universe.ship.pos) < 10_000
    ) {
        const textureScale = planet.radius / (planetTextureSize / 2);
        const textureRot   = PI2f * ((planet.radius % 100) / 100);
        const textureIdx   = Math.floor((planet.radius % 17) / 17 * planetTextures.length);
        const textureArt   = planetTextures[textureIdx];

        ctx.save();
        // clip to planet circle
        ctx.beginPath();
        ctx.arc(0, 0, planet.radius, 0, PI2f);
        ctx.clip();

        ctx.rotate(textureRot);
        ctx.translate(-planet.radius, -planet.radius);
        ctx.scale(textureScale, textureScale);

        ctx.strokeStyle = drawColor;
        ctx.lineWidth   = 1 / zoom / textureScale;
        ctx.stroke(textureArt);
        ctx.restore();
    }

    // Planet border circle
    ctx.beginPath();
    ctx.arc(0, 0, planet.radius, 0, PI2f);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth   = 2 / zoom;
    ctx.stroke();

    ctx.restore();
}

// ── drawStar ──────────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawStar()
export function drawStar(ctx, star, now, zoom, visibleRect = null) {
    // Gravitational field rings for the star (drawn in world space, concentric with star.pos)
    if (DRAW_STAR_GRAVITATIONAL_FIELDS_FLAG) {
        drawGravitationalField(ctx, star, now, zoom, visibleRect);
    }

    ctx.save();
    ctx.translate(star.pos.x, star.pos.y);

    // Star filled circle
    ctx.beginPath();
    ctx.arc(0, 0, star.radius, 0, PI2f);
    ctx.fillStyle = star.color;
    ctx.fill();

    // Cache coronas so we don't construct 62-vertex Path2D objects with arcTo every single frame
    if (!star._corona1) {
        star._corona1 = createStar(star.radius + 80, star.radius + 250, STAR_POINTS, 200);
        star._corona2 = createStar(star.radius + 20, star.radius + 200, STAR_POINTS + 1, 200);
    }

    // Corona 1: STAR_POINTS points, rotating with anim/23, rounded corners (200px)
    ctx.save();
    ctx.rotate((star.anim / 23) * PI2f);
    ctx.strokeStyle = star.color;
    ctx.lineWidth   = 3 / zoom;
    ctx.stroke(star._corona1);
    ctx.restore();

    // Corona 2: STAR_POINTS+1 points, rotating with -anim/19, rounded corners (200px)
    ctx.save();
    ctx.rotate((star.anim / -19) * PI2f);
    ctx.strokeStyle = star.color;
    ctx.lineWidth   = 3 / zoom;
    ctx.stroke(star._corona2);
    ctx.restore();

    ctx.restore();
}

// ── drawSpacecraft ────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawSpacecraft()
export function drawSpacecraft(ctx, ship, zoom) {
    // Draw track first (in world space, no ship rotation)
    drawTrack(ctx, ship.track, zoom);

    // Draw ship body (rotated around ship.pos)
    ctx.save();
    ctx.translate(ship.pos.x, ship.pos.y);
    ctx.rotate(ship.angle);

    // Landing legs (only when landed)
    if (ship.landing !== null) {
        ctx.strokeStyle = '#CCCCCC';
        ctx.lineWidth   = 2 / zoom;
        ctx.stroke(spaceshipLegs);
    }

    // Ship body fill (fauxpaque background)
    ctx.fillStyle = ship.transit ? '#000000' : '#16161D';
    ctx.fill(spaceshipPath);

    // Ship body outline
    ctx.strokeStyle = ship.transit ? '#000000' : '#FFFFFF';
    ctx.lineWidth   = 2 / zoom;
    ctx.stroke(spaceshipPath);

    // Thrust flame
    if (ship.thrust.mag() > 0) {
        ctx.strokeStyle = '#FF8800';
        ctx.lineWidth   = 2 / zoom;
        ctx.lineJoin    = 'round'; // cornerPathEffect(1)
        ctx.stroke(thrustPath);
    }

    ctx.restore();
}

// ── drawLanding ───────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawLanding()
// flagFlag() is always true on web (feature flag always enabled)
export function drawLanding(ctx, landing, zoom) {
    // Plant flag beside the lander along the planet surface (offset ~25px)
    const angleOffset = Math.min(0.2, 25 / landing.planet.radius);
    const flagAngle   = landing.angle + angleOffset;
    const v = landing.planet.pos.plus(
        Vec2.makeWithAngleMag(flagAngle, landing.planet.radius)
    );
    const strokeWidth = 2 / zoom;
    const height      = 80;

    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(flagAngle);

    // Flag shape from VisibleUniverse.kt
    const flagPath = new Path2D();
    flagPath.moveTo(0, 0);
    flagPath.lineTo(height, 0);
    flagPath.lineTo(height * 0.875, height * 0.25);
    flagPath.lineTo(height * 0.75, 0);
    flagPath.closePath();

    ctx.strokeStyle = Colors.Flag;
    ctx.lineWidth   = strokeWidth;
    ctx.stroke(flagPath);

    ctx.restore();
}

// ── drawSpark ─────────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawSpark()
export function drawSpark(ctx, spark, zoom) {
    if (spark.fuse.lifetime < 0) return;
    const life = 1 - spark.fuse.lifetime / spark.ttl;

    ctx.save();
    switch (spark.style) {
        case Spark.Style.LINE:
            if (spark.opos.x !== 0 || spark.opos.y !== 0) {
                ctx.beginPath();
                ctx.moveTo(spark.opos.x, spark.opos.y);
                ctx.lineTo(spark.pos.x, spark.pos.y);
                ctx.strokeStyle = spark.color;
                ctx.lineWidth   = spark.size;
                ctx.stroke();
            }
            break;

        case Spark.Style.LINE_ABSOLUTE:
            if (spark.opos.x !== 0 || spark.opos.y !== 0) {
                ctx.beginPath();
                ctx.moveTo(spark.opos.x, spark.opos.y);
                ctx.lineTo(spark.pos.x, spark.pos.y);
                ctx.strokeStyle = spark.color;
                ctx.lineWidth   = spark.size / zoom;
                ctx.stroke();
            }
            break;

        case Spark.Style.DOT:
            ctx.beginPath();
            ctx.arc(spark.pos.x, spark.pos.y, spark.size, 0, PI2f);
            ctx.fillStyle = spark.color;
            ctx.fill();
            break;

        case Spark.Style.DOT_ABSOLUTE:
            ctx.beginPath();
            // DOT_ABSOLUTE: circle at pos / zoom — this positions in screen space
            ctx.arc(spark.pos.x / zoom, spark.pos.y / zoom, spark.size, 0, PI2f);
            ctx.fillStyle = spark.color;
            ctx.fill();
            break;

        case Spark.Style.RING: {
            // radius = exp(lerp(size, 3*size, life)) - 1
            const r     = Math.exp(lerp(spark.size, 3 * spark.size, life)) - 1;
            const alpha = parseAlpha(spark.color) * (1 - life);
            ctx.beginPath();
            ctx.arc(spark.pos.x, spark.pos.y, r, 0, PI2f);
            ctx.strokeStyle = withAlpha(spark.color, alpha);
            ctx.lineWidth   = 1 / zoom;
            ctx.stroke();
            break;
        }
    }
    ctx.restore();
}

// helper: parse the alpha component from rgba() or default to 1
function parseAlpha(colorStr) {
    const m = colorStr.match(/rgba?\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
    return m ? parseFloat(m[1]) : 1;
}

// ── drawTrack ─────────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawTrack() with SIMPLE_TRACK_DRAWING=true
// Uses PointMode.Lines: pairs of points connected as line segments.
export function drawTrack(ctx, track, zoom) {
    const positions = track.positions;
    if (positions.length < 2) return;

    ctx.beginPath();
    // PointMode.Lines: draw a line between positions[0]→[1], [2]→[3], etc.
    for (let i = 0; i + 1 < positions.length; i += 2) {
        ctx.moveTo(positions[i].x, positions[i].y);
        ctx.lineTo(positions[i + 1].x, positions[i + 1].y);
    }
    ctx.strokeStyle = Colors.Track;
    ctx.lineWidth   = 1 / zoom;
    ctx.stroke();
}

// ── drawAutopilot ─────────────────────────────────────────────────────────────
// VisibleUniverse.kt: drawAutopilot()
export function drawAutopilot(ctx, autopilot, universe, zoom) {
    if (!autopilot.target) return;

    const color     = withAlpha(Colors.Autopilot, 0.5);
    const target    = autopilot.target;
    const rotAngle  = universe.now * PI2f / 10;

    ctx.save();
    ctx.translate(target.pos.x, target.pos.y);
    ctx.rotate(rotAngle);

    // 15-sided polygon at braking distance radius
    const brakePoly = createPolygon(
        target.radius + autopilot.brakingDistance,
        15   // Autopilot introduced in Android 15
    );
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1 / zoom;
    ctx.stroke(brakePoly);

    // Thick landing-altitude ring
    const innerR    = target.radius + autopilot.landingAltitude / 2;
    const ringWidth = autopilot.landingAltitude;
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, PI2f);
    ctx.strokeStyle = withAlpha(Colors.Autopilot, 0.25 * 0.5); // alpha=0.25 * ring opacity
    ctx.lineWidth   = ringWidth;
    ctx.stroke();

    ctx.restore();

    // Line from ship to leading point
    ctx.beginPath();
    ctx.moveTo(autopilot.ship.pos.x, autopilot.ship.pos.y);
    ctx.lineTo(autopilot.leadingPos.x, autopilot.leadingPos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1 / zoom;
    ctx.stroke();

    // Circle at leading point
    ctx.beginPath();
    ctx.arc(autopilot.leadingPos.x, autopilot.leadingPos.y, 5 / zoom, 0, PI2f);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1 / zoom;
    ctx.stroke();
}
