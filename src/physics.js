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

// Port of com.android.egg.landroid.Physics.kt

import { Vec2 } from './math.js';
import { XorWowRandom } from './randomness.js';

export const TIME_SCALE = 1.0; // simulation seconds per wall clock second
export const MAX_VALID_DT = 1.0; // pause threshold

/**
 * Fuse countdown for temporary removable objects
 */
export class Fuse {
    constructor(lifetime) {
        this.lifetime = lifetime;
    }

    update(dt) {
        this.lifetime -= dt;
    }

    canBeRemoved() {
        return this.lifetime < 0;
    }
}

/**
 * Physical body in simulation
 */
export class Body {
    constructor(name = "Unknown") {
        this.name = name;
        this.pos = Vec2.Zero;
        this.opos = Vec2.Zero;
        this.velocity = Vec2.Zero;
        this.mass = 0;
        this.angle = 0;
        this.radius = 0;
        this.collides = true;
        this.oangle = 0;
    }

    get omega() {
        return this.angle - this.oangle;
    }

    set omega(value) {
        this.oangle = this.angle - value;
    }

    update(sim, dt) {
        if (dt <= 0) return;
        const vscaled = this.velocity.times(dt);
        this.opos = this.pos;
        this.pos = this.pos.plus(vscaled);
    }

    postUpdate(sim, dt) {
        if (dt <= 0) return;
        this.velocity = this.pos.minus(this.opos).div(dt);
    }
}

/**
 * Container boundary constraint
 */
export class Container {
    constructor(radius) {
        this.radius = radius;
        this.list = new Set();
        this.softness = 0.0;
    }

    add(p) {
        this.list.add(p);
    }

    remove(p) {
        this.list.delete(p);
    }

    solve(sim, dt) {
        for (const p of this.list) {
            if ((p.pos.mag() + p.radius) > this.radius) {
                const angle = p.pos.angle();
                const targetPos = Vec2.makeWithAngleMag(angle, this.radius - p.radius);
                p.pos = p.pos.times(this.softness).plus(targetPos.times(1 - this.softness));
            }
        }
    }
}

/**
 * Simulator core loop
 */
export class Simulator {
    constructor(randomSeed) {
        this.randomSeed = randomSeed;
        this.wallClockNanos = 0n;
        this.now = 0;
        this.dt = 0;
        this.rng = XorWowRandom.fromLong(randomSeed);
        this.entities = new Set();
        this.constraints = new Set();
        this.simStepListeners = [];
    }

    add(e) {
        if (e.solve !== undefined) {
            this.constraints.add(e);
        } else {
            this.entities.add(e);
        }
    }

    remove(e) {
        if (e.solve !== undefined) {
            this.constraints.delete(e);
        } else {
            this.entities.delete(e);
        }
    }

    updateAll(dt, entities) {
        for (const entity of entities) {
            entity.update(this, dt);
        }
    }

    solveAll(dt, constraints) {
        for (const constraint of constraints) {
            constraint.solve(this, dt);
        }
    }

    postUpdateAll(dt, entities) {
        for (const entity of entities) {
            entity.postUpdate(this, dt);
        }
    }

    step(nanos) {
        const firstFrame = (this.wallClockNanos === 0n);
        this.dt = Number(nanos - this.wallClockNanos) / 1_000_000_000 * TIME_SCALE;
        this.wallClockNanos = nanos;

        if (firstFrame || this.dt > MAX_VALID_DT) return;

        this.now += this.dt;

        const localEntities = new Set(this.entities);
        const localConstraints = new Set(this.constraints);

        // Position-based dynamics:
        // 1. apply forces & integrate velocity to position
        this.updateAll(this.dt, localEntities);

        // 2. solve all constraints
        this.solveAll(this.dt, localConstraints);

        // 3. compute new velocities from positions
        this.postUpdateAll(this.dt, localEntities);

        // 4. step complete
        for (const listener of this.simStepListeners) {
            listener();
        }
    }

    addSimulationStepListener(listener) {
        this.simStepListeners.push(listener);
        return () => {
            const idx = this.simStepListeners.indexOf(listener);
            if (idx >= 0) this.simStepListeners.splice(idx, 1);
        };
    }
}

