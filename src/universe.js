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

// Port of com.android.egg.landroid.Universe.kt

import { Vec2, PIf, PI2f, lerp } from './math.js';
import { Simulator, Body, Fuse, Container } from './physics.js';

// ── Universe constants (Universe.kt top-level) ───────────────────────────────
export const UNIVERSE_RANGE = 200_000;

export const NUM_PLANETS_MIN = 1;
export const NUM_PLANETS_MAX = 10;

export const STAR_RADIUS_MIN  = 1_000;
export const STAR_RADIUS_MAX  = 8_000;

export const PLANET_RADIUS_MIN = 50;
export const PLANET_RADIUS_MAX = 2_000;

// PLANET_ORBIT_RANGE = (STAR_RADIUS_MAX * 2)..(UNIVERSE_RANGE * 0.75)
export const PLANET_ORBIT_MIN = STAR_RADIUS_MAX * 2;          // 16 000
export const PLANET_ORBIT_MAX = UNIVERSE_RANGE * 0.75;         // 150 000

export const GRAVITATION        = 1e-2;
export const KEPLER_CONSTANT    = 50;

export const PLANETARY_DENSITY  = 2.5;
export const STELLAR_DENSITY    = 0.5;
export const SPACECRAFT_MASS    = 10;

export const CRAFT_SPEED_LIMIT  = 5_000;
export const MAIN_ENGINE_ACCEL  = 1_000;   // pixels per second squared
export const LAUNCH_MECO        = 2;        // seconds, gravity suspended after launch
export const SCALED_THRUST      = true;

export const LANDING_REMOVAL_TIME = 60 * 15; // 15 min of simulation time

export const TRACK_LENGTH        = 10_000;
export const SIMPLE_TRACK_DRAWING = true;

// ── Star spectral classes ────────────────────────────────────────────────────
// StarClass enum from Universe.kt
export const StarClass = Object.freeze(['O', 'B', 'A', 'F', 'G', 'K', 'M']);

export function starColor(cls) {
    // starColor() from Universe.kt
    switch (cls) {
        case 'O': return '#6666FF';
        case 'B': return '#CCCCFF';
        case 'A': return '#EEEEFF';
        case 'F': return '#FFFFFF';
        case 'G': return '#FFFF66';
        case 'K': return '#FFCC33';
        case 'M': return '#FF8800';
        default:  return '#FFFFFF';
    }
}

// ── HSV helper (Color.hsv from Compose) ─────────────────────────────────────
// Used for planet color generation. hue in [0,360), sat/val in [0,1].
export function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if      (h < 60)  { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    const ri = Math.round((r + m) * 255);
    const gi = Math.round((g + m) * 255);
    const bi = Math.round((b + m) * 255);
    return `rgb(${ri},${gi},${bi})`;
}

// ── Planet ───────────────────────────────────────────────────────────────────
// Port of Planet class in Universe.kt
export class Planet extends Body {
    constructor(orbitCenter, radius, pos, speed, color = '#FFFFFF') {
        super('Planet');
        this.orbitCenter = orbitCenter;
        this.radius      = radius;
        this.pos         = pos;
        this.speed       = speed;
        this.color       = color;
        this.orbitRadius = pos.distance(orbitCenter);
        // mass = 4/3 * PI * r^3 * density
        this.mass = (4 / 3) * PIf * Math.pow(radius, 3) * PLANETARY_DENSITY;

        this.atmosphere  = '';
        this.description = '';
        this.flora       = '';
        this.fauna       = '';
        this.explored    = false;
    }

    update(sim, dt) {
        // constant linear velocity tangent to orbit (Universe.kt Planet.update)
        const orbitAngle = this.pos.minus(this.orbitCenter).angle();
        this.velocity = Vec2.makeWithAngleMag(orbitAngle + PIf / 2, this.speed);
        super.update(sim, dt);
    }

    postUpdate(sim, dt) {
        // snap back onto the circular orbit radius (Universe.kt Planet.postUpdate)
        const orbitAngle = this.pos.minus(this.orbitCenter).angle();
        this.pos = this.orbitCenter.plus(Vec2.makeWithAngleMag(orbitAngle, this.orbitRadius));
        super.postUpdate(sim, dt);
    }
}

// ── Star ─────────────────────────────────────────────────────────────────────
// Port of Star class in Universe.kt
export class Star extends Planet {
    constructor(cls, radius) {
        // orbitCenter=Vec2.Zero, pos=Vec2.Zero, speed=0
        super(Vec2.Zero, radius, Vec2.Zero, 0, starColor(cls));
        this.cls     = cls;
        this.pos     = Vec2.Zero;
        // override mass with stellar density
        this.mass    = (4 / 3) * PIf * Math.pow(radius, 3) * STELLAR_DENSITY;
        this.color   = starColor(cls);
        this.collides = false;
        this.anim    = 0;
    }

    update(sim, dt) {
        // Star just increments anim; does NOT call super (Universe.kt Star.update)
        this.anim += dt;
    }
}

// ── Track ─────────────────────────────────────────────────────────────────────
// Port of Track class in Universe.kt
export class Track {
    constructor() {
        this.positions = []; // flat pairs added via add()
        this.angles    = [];
    }

    add(x, y, a) {
        // Universe.kt: if positions.size >= TRACK_LENGTH-1, removeFirst twice
        if (this.positions.length >= (TRACK_LENGTH - 1)) {
            this.positions.splice(0, 2); // remove 2 Vec2s (simulate removeFirst x2)
            this.angles.splice(0, 2);
        }
        this.positions.push(new Vec2(x, y));
        this.angles.push(a);
    }
}

// ── Spacecraft ───────────────────────────────────────────────────────────────
// Port of Spacecraft class in Universe.kt
export class Spacecraft extends Body {
    constructor() {
        super('Spacecraft');
        this.mass    = SPACECRAFT_MASS;
        this.radius  = 12;
        this.thrust  = Vec2.Zero;
        this.launchClock = 0;
        this.transit    = false;
        this.track      = new Track();
        this.landing    = null;
        this.autopilot  = null;
    }

    update(sim, dt) {
        const thrustMag = this.thrust.mag();
        if (thrustMag > 0) {
            let deltaV = MAIN_ENGINE_ACCEL * dt;
            if (SCALED_THRUST) deltaV *= Math.min(Math.max(thrustMag, 0), 1);

            if (this.landing !== null) {
                // launch sequence: 1-second burn before detach (Universe.kt Spacecraft.update)
                if (this.launchClock === 0) this.launchClock = sim.now + 1.0;
                if (sim.now > this.launchClock) {
                    this.landing.ship = null;
                    this.landing = null;
                } else {
                    deltaV = 0;
                }
            }

            this.velocity = this.velocity.plus(Vec2.makeWithAngleMag(this.angle, deltaV));
        } else {
            if (this.launchClock !== 0) this.launchClock = 0;
        }

        // apply global speed limit
        if (this.velocity.mag() > CRAFT_SPEED_LIMIT) {
            this.velocity = Vec2.makeWithAngleMag(this.velocity.angle(), CRAFT_SPEED_LIMIT);
        }

        super.update(sim, dt);
    }

    postUpdate(sim, dt) {
        super.postUpdate(sim, dt);

        // add to breadcrumb track
        this.track.add(this.pos.x, this.pos.y, this.angle);

        // exhaust spark effect
        const mag = this.thrust.mag();
        if (sim.rng.nextFloat() < mag) {
            const spark = new Spark(
                sim.rng.nextFloatInRange(0.5, 1.0),
                true,   // collides
                1,      // mass
                Spark.Style.RING,
                'rgba(255,255,255,0.25)',   // Color(0x40FFFFFF) ≈ alpha=0.25
                1
            );
            spark.pos   = this.pos;
            spark.opos  = this.pos;
            const randAngleOffset = sim.rng.nextFloatInRange(-0.2, 0.2);
            spark.velocity = this.velocity.plus(
                Vec2.makeWithAngleMag(
                    this.angle + randAngleOffset,
                    -MAIN_ENGINE_ACCEL * mag * 10 * dt
                )
            );
            sim.add(spark);
        }
    }
}

// ── Landing constraint ────────────────────────────────────────────────────────
// Port of Landing class in Universe.kt. Has a .solve() so it goes into constraints.
export class Landing {
    constructor(ship, planet, angle, text = '') {
        this.ship   = ship;    // nullable, set to null on launch
        this.planet = planet;
        this.angle  = angle;
        this.text   = text;
        this.fuse   = new Fuse(LANDING_REMOVAL_TIME);
    }

    solve(sim, dt) {
        if (this.ship !== null) {
            const landingVector = Vec2.makeWithAngleMag(this.angle, this.ship.radius + this.planet.radius);
            const desiredPos    = this.planet.pos.plus(landingVector);
            // lerp snap (Universe.kt: ship.pos = ship.pos * 0.5 + desiredPos * 0.5)
            this.ship.pos   = this.ship.pos.times(0.5).plus(desiredPos.times(0.5));
            this.ship.angle = this.angle;
        }
        this.fuse.update(dt);
    }

    canBeRemoved() {
        return this.fuse.canBeRemoved();
    }
}

// ── Spark ─────────────────────────────────────────────────────────────────────
// Port of Spark class in Universe.kt
export class Spark extends Body {
    constructor(ttl, collides = false, mass = 0, style = Spark.Style.LINE, color = '#888888', size = 2) {
        super('Spark');
        this.ttl      = ttl;
        this.collides = collides;
        this.mass     = mass;
        this.style    = style;
        this.color    = color;
        this.size     = size;
        this.fuse     = new Fuse(ttl);
    }

    update(sim, dt) {
        super.update(sim, dt);
        this.fuse.update(dt);
    }

    canBeRemoved() {
        return this.fuse.canBeRemoved();
    }
}

Spark.Style = Object.freeze({
    LINE:          'LINE',
    LINE_ABSOLUTE: 'LINE_ABSOLUTE',
    DOT:           'DOT',
    DOT_ABSOLUTE:  'DOT_ABSOLUTE',
    RING:          'RING',
});

// ── Universe ──────────────────────────────────────────────────────────────────
// Port of Universe class in Universe.kt
export class Universe extends Simulator {
    constructor(namer, randomSeed) {
        super(randomSeed);
        this.namer          = namer;
        this.latestDiscovery = null;
        this.star           = null;
        this.ship           = null;
        this.planets        = [];    // sorted by orbit distance after init
        this.follow         = null;
        this.ringfence      = new Container(UNIVERSE_RANGE);
    }

    // Override add so Planet/Star instances are also tracked in this.planets.
    // NOTE: Container and Landing have .solve, so they go to constraints via Simulator.add().
    // We track planets manually here.
    add(e) {
        // If it's a planet (but NOT going via constraints path), track it
        // Stars are Planets; they get tracked here too then filtered in drawUniverse.
        // We rely on the caller (initRandom) to push to this.planets before calling add().
        super.add(e);
    }

    // Universe.kt initRandom()
    initRandom() {
        const rng = this.rng;

        const systemName = this.namer.nameSystem(rng);

        const cls    = rng.choose(StarClass);
        const radius = rng.nextFloatInRange(STAR_RADIUS_MIN, STAR_RADIUS_MAX);
        this.star    = new Star(cls, radius);
        this.star.name = systemName;

        const planetCount = rng.nextIntRange(NUM_PLANETS_MIN, NUM_PLANETS_MAX + 1);
        for (let i = 0; i < planetCount; i++) {
            const pRadius = rng.nextFloatInRange(PLANET_RADIUS_MIN, PLANET_RADIUS_MAX);
            // rng.nextFloat().pow(1) = just rng.nextFloat() (exponent=1 is identity)
            const orbitFrac   = rng.nextFloat();
            const orbitRadius = lerp(PLANET_ORBIT_MIN, PLANET_ORBIT_MAX, orbitFrac);

            // Kepler's third law: T = sqrt(r^3 / M) * K
            const period = Math.sqrt(Math.pow(orbitRadius, 3) / this.star.mass) * KEPLER_CONSTANT;
            const speed  = 2 * PIf * orbitRadius / period;

            const orbitAngle = rng.nextFloat() * PI2f;
            const hue = pRadius % 360;
            const color = hsvToRgb(hue, 0.75, 1.0);

            const p = new Planet(
                this.star.pos,
                pRadius,
                this.star.pos.plus(Vec2.makeWithAngleMag(orbitAngle, orbitRadius)),
                speed,
                color
            );
            p.description = this.namer.describePlanet(rng);
            p.atmosphere  = this.namer.describeAtmo(rng);
            p.flora       = this.namer.describeLife(rng);
            p.fauna       = this.namer.describeLife(rng);
            this.planets.push(p);
            super.add(p);   // goes to entities
        }

        // Sort planets by orbit distance from star
        this.planets.sort((a, b) => a.pos.distance(this.star.pos) - b.pos.distance(this.star.pos));
        this.planets.forEach((planet, idx) => {
            planet.name = `${systemName} ${idx + 1}`;
        });

        super.add(this.star); // star also goes to entities

        this.ship = new Spacecraft();
        const shipOrbitAngle  = rng.nextFloat() * PI2f;
        const shipOrbitRadius = rng.nextFloatInRange(PLANET_ORBIT_MIN, PLANET_ORBIT_MAX);
        this.ship.pos   = this.star.pos.plus(Vec2.makeWithAngleMag(shipOrbitAngle, shipOrbitRadius));
        this.ship.angle = rng.nextFloat() * PI2f;
        super.add(this.ship);

        this.ringfence.add(this.ship);
        super.add(this.ringfence);   // goes to constraints (has .solve)

        this.follow = this.ship;
    }

    // Universe.kt initTest()
    initTest() {
        const systemName = 'TEST SYSTEM';
        this.star = new Star('A', STAR_RADIUS_MAX);
        this.star.name = systemName;

        for (let i = 0; i < NUM_PLANETS_MAX; i++) {
            const frac        = i / (NUM_PLANETS_MAX - 1);
            const pRadius     = lerp(PLANET_RADIUS_MIN, PLANET_RADIUS_MAX, frac);
            const orbitRadius = lerp(PLANET_ORBIT_MIN, PLANET_ORBIT_MAX, frac);
            const period      = Math.sqrt(Math.pow(orbitRadius, 3) / this.star.mass) * KEPLER_CONSTANT;
            const speed       = 2 * PIf * orbitRadius / period;
            const hue         = frac * 360;

            const p = new Planet(
                this.star.pos,
                pRadius,
                this.star.pos.plus(Vec2.makeWithAngleMag(frac * PI2f, orbitRadius)),
                speed,
                hsvToRgb(hue, 1, 1)
            );
            p.description = `TEST PLANET #${i + 1}`;
            p.atmosphere  = `radius=${pRadius}`;
            p.flora       = `mass=${p.mass}`;
            p.fauna       = `speed=${speed}`;
            this.planets.push(p);
            super.add(p);
        }

        this.planets.sort((a, b) => a.pos.distance(this.star.pos) - b.pos.distance(this.star.pos));
        this.planets.forEach((planet, idx) => { planet.name = `${systemName} ${idx + 1}`; });
        super.add(this.star);

        this.ship = new Spacecraft();
        this.ship.pos   = this.planets[this.planets.length - 1].pos.plus(new Vec2(this.planets[0].radius * 1.5, 0));
        this.ship.angle = 0;
        super.add(this.ship);

        this.ringfence.add(this.ship);
        super.add(this.ringfence);

        this.follow = this.ship;
    }

    // Universe.kt closestPlanet()
    closestPlanet() {
        let best = null, bestDist = Infinity;
        for (const p of [...this.planets, this.star]) {
            const d = p.pos.minus(this.ship.pos).mag();
            if (d < bestDist) { bestDist = d; best = p; }
        }
        return best;
    }

    // Universe.kt updateAll() — gravity from all bodies onto ship
    updateAll(dt, entities) {
        this.ship.transit = false;

        for (const planet of [...this.planets, this.star]) {
            const vector = planet.pos.minus(this.ship.pos);
            const d      = vector.mag();
            if (d < planet.radius) {
                if (planet instanceof Star) this.ship.transit = true;
            } else if (this.now > this.ship.launchClock + LAUNCH_MECO) {
                // F_g = G * m1 * m2 / d^2, applied as impulse
                const forceMag = GRAVITATION * (this.ship.mass * planet.mass) / (d * d);
                this.ship.velocity = this.ship.velocity.plus(
                    Vec2.makeWithAngleMag(vector.angle(), forceMag).times(dt)
                );
            }
        }

        super.updateAll(dt, entities);
    }

    // Universe.kt solveAll() — landing / crash detection
    solveAll(dt, constraints) {
        if (this.ship.landing === null) {
            const planet = this.closestPlanet();
            if (planet.collides) {
                const diff = this.ship.pos.minus(planet.pos);
                const d    = diff.mag() - this.ship.radius - planet.radius;
                const a    = diff.angle();

                if (d < 0) {
                    const aDiff = Math.abs(this.ship.angle - a);
                    if (aDiff < PIf / 4) {
                        // Landing!
                        const landing = new Landing(
                            this.ship, planet, a,
                            this.namer.describeActivity(this.rng, planet)
                        );
                        this.ship.landing   = landing;
                        this.ship.velocity  = planet.velocity;
                        this.add(landing);   // goes to constraints via .solve check

                        planet.explored     = true;
                        this.latestDiscovery = planet;
                    } else {
                        // Crash! push ship out + scatter sparks
                        this.ship.pos = planet.pos.plus(
                            Vec2.makeWithAngleMag(a, planet.radius + this.ship.radius - d)
                        );

                        for (let i = 0; i < 10; i++) {
                            const spark = new Spark(
                                this.rng.nextFloatInRange(0.5, 2.0),
                                false,
                                0,
                                Spark.Style.DOT,
                                '#FFFFFF',
                                1
                            );
                            const impact = planet.pos.plus(Vec2.makeWithAngleMag(a, planet.radius));
                            spark.pos  = impact.plus(Vec2.makeWithAngleMag(
                                this.rng.nextFloatInRange(0, 2 * PIf),
                                this.rng.nextFloatInRange(0.1, 0.5)
                            ));
                            spark.opos     = spark.pos;
                            spark.velocity = this.ship.velocity.times(0.8).plus(
                                Vec2.makeWithAngleMag(
                                    this.rng.nextFloatInRange(0, 2 * PIf),
                                    this.rng.nextFloatInRange(0.1, 0.5)
                                )
                            );
                            this.add(spark);
                        }
                    }
                }
            }
        }

        super.solveAll(dt, constraints);
    }

    // Universe.kt postUpdateAll() — remove dead entities and constraints
    postUpdateAll(dt, entities) {
        super.postUpdateAll(dt, entities);

        // Remove expired entities (Spark fuses etc.)
        for (const e of entities) {
            if (typeof e.canBeRemoved === 'function' && e.canBeRemoved()) {
                this.entities.delete(e);
            }
        }
        // Remove expired constraints (Landing fuses)
        for (const c of new Set(this.constraints)) {
            if (typeof c.canBeRemoved === 'function' && c.canBeRemoved()) {
                this.constraints.delete(c);
            }
        }
    }
}

