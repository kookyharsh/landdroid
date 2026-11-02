// Copyright (C) 2024 The Android Open Source Project
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

// Port of com.android.egg.landroid.Autopilot.kt

import { Vec2, PI2f } from './math.js';
import { MAIN_ENGINE_ACCEL } from './universe.js';
import { expSmooth } from './math.js';

// ── Autopilot ─────────────────────────────────────────────────────────────────
// Port of Autopilot class in Autopilot.kt
// Autopilot is an Entity (has update + postUpdate), so it goes in sim.entities.
export class Autopilot {
    constructor(ship, universe) {
        this.ship     = ship;
        this.universe = universe;

        // Autopilot.kt constants
        this.BRAKING_TIME       = 5;
        this.SIGHTSEEING_TIME   = 15;
        this.LAUNCH_THRUST_TIME = 5;
        this.STRATEGY_MIN_TIME  = 0.5;

        this.enabled          = false;
        this.target           = null;
        this.landingAltitude  = 0;
        this.nextStrategyTime = 0;
        this.brakingDistance  = 0;

        // used by rendering (Autopilot.kt: leadingPos, leadingVector)
        this.leadingPos    = Vec2.Zero;
        this.leadingVector = Vec2.Zero;

        this.strategy = 'NONE';
        this._debug   = '';
    }

    // Autopilot.kt: val telemetry: String
    get telemetry() {
        if (!this.enabled) return '';
        const targetName = this.target ? this.target.name.toUpperCase() : 'SELECTING...';
        const debugPart  = this._debug.length > 0 ? ` (${this._debug})` : '';
        return [
            '---- AUTOPILOT ENGAGED ----',
            `TGT: ${targetName}`,
            `EXE: ${this.strategy}${debugPart}`,
        ].join('\n');
    }

    // Autopilot.kt: override fun update(sim: Simulator, dt: Float)
    update(sim, dt) {
        if (!this.enabled) return;
        if (sim.now < this.nextStrategyTime) return;

        const currentStrategy = this.strategy;

        if (this.ship.landing !== null) {
            // We just landed
            if (this.target !== null) {
                // arrived — sightsee for a while
                this.strategy = 'LANDED';
                this._debug   = '';
                this.target   = null;
                this.landingAltitude = 0;
                this.nextStrategyTime = sim.now + this.SIGHTSEEING_TIME;
            } else {
                // already sightseeing, now launch
                this.ship.thrust = Vec2.makeWithAngleMag(this.ship.angle, 1);
                this.strategy = 'LAUNCHING';
                this._debug   = '';
                this.nextStrategyTime = sim.now + this.LAUNCH_THRUST_TIME;
            }
        } else {
            // In space — select or pursue target
            if (this.target === null) {
                // prefer nearest unexplored planet
                const sorted = this.universe.planets
                    .slice()
                    .sort((a, b) => a.pos.minus(this.ship.pos).mag() - b.pos.minus(this.ship.pos).mag());
                this.target = sorted.find(p => !p.explored) || null;
                this.brakingDistance = 0;

                // if all explored, pick random
                if (this.target === null && this.universe.planets.length > 0) {
                    this.target = this.universe.planets[
                        Math.floor(Math.random() * this.universe.planets.length)
                    ];
                }
            }

            if (this.target !== null) {
                const target  = this.target;
                const shipV   = this.ship.velocity;
                const targetV = target.velocity;
                const targetVector = target.pos.minus(this.ship.pos);
                const altitude     = targetVector.mag() - target.radius;

                this.landingAltitude = Math.min(target.radius, 100);

                // relative frame of target
                const relativeV    = shipV.minus(targetV);
                const unit         = targetVector.div(targetVector.mag());
                const projection   = relativeV.dot(unit);
                const relativeSpeed = relativeV.mag() * Math.sign(projection);
                const timeToTarget  = relativeSpeed !== 0 ? altitude / relativeSpeed : 1_000;

                const newBrakingDistance = this.BRAKING_TIME *
                    (relativeSpeed > 0 ? relativeSpeed : MAIN_ENGINE_ACCEL);
                this.brakingDistance = expSmooth(
                    this.brakingDistance, newBrakingDistance, sim.dt, 5
                );

                // lead the target
                this.leadingPos = target.pos.plus(
                    Vec2.makeWithAngleMag(
                        target.velocity.angle(),
                        Math.min(altitude / 2, target.velocity.mag())
                    )
                );
                this.leadingVector = this.leadingPos.minus(this.ship.pos);

                if (altitude < this.landingAltitude) {
                    // LANDING strategy
                    this.strategy = 'LANDING';
                    this.ship.angle  = this.ship.pos.minus(target.pos).angle(); // face away from ground
                    this.ship.thrust = Vec2.Zero;
                } else {
                    if (relativeSpeed < 0 || altitude > this.brakingDistance) {
                        // CHASING
                        this.strategy = 'CHASING';
                        this.ship.angle  = this.leadingVector.angle();
                        this.ship.thrust = Vec2.makeWithAngleMag(this.ship.angle, 1);
                    } else {
                        // APPROACHING — slow down
                        this.strategy    = 'APPROACHING';
                        this.ship.angle  = this.ship.velocity.times(-1).angle();
                        const decel      = relativeSpeed / timeToTarget;
                        const decelThrust = decel / MAIN_ENGINE_ACCEL * 0.9;
                        this.ship.thrust = Vec2.makeWithAngleMag(this.ship.angle, decelThrust);
                    }
                }

                this._debug = `DV=${relativeSpeed.toFixed(0)} D=${altitude.toFixed(0)} T${timeToTarget >= 0 ? '+' : ''}${timeToTarget.toFixed(1)}`;
            }

            if (this.strategy !== currentStrategy) {
                this.nextStrategyTime = sim.now + this.STRATEGY_MIN_TIME;
            }
        }
    }

    // Autopilot.kt: override fun postUpdate(sim: Simulator, dt: Float)
    postUpdate(sim, dt) {
        // nothing to do when disabled
    }
}

