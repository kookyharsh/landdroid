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

// Port of com.android.egg.landroid.Vec2.kt & Maths.kt

export const PIf = Math.PI;
export const PI2f = 2 * Math.PI;

/**
 * 2D vector class mirroring Vec2.kt (typealias to Offset)
 */
export class Vec2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    static get Zero() {
        return new Vec2(0, 0);
    }

    static makeWithAngleMag(a, m) {
        return new Vec2(m * Math.cos(a), m * Math.sin(a));
    }

    plus(other) {
        return new Vec2(this.x + other.x, this.y + other.y);
    }

    minus(other) {
        return new Vec2(this.x - other.x, this.y - other.y);
    }

    times(scalar) {
        return new Vec2(this.x * scalar, this.y * scalar);
    }

    div(scalar) {
        return new Vec2(this.x / scalar, this.y / scalar);
    }

    mag() {
        return Math.hypot(this.x, this.y);
    }

    distance(other) {
        return Math.hypot(this.x - other.x, this.y - other.y);
    }

    angle() {
        return Math.atan2(this.y, this.x);
    }

    dot(other) {
        return this.x * other.x + this.y * other.y;
    }

    rotate(angle, origin = Vec2.Zero) {
        const tx = this.x - origin.x;
        const ty = this.y - origin.y;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        return new Vec2(
            origin.x + (tx * cosA - ty * sinA),
            origin.y + (tx * sinA + ty * cosA)
        );
    }

    str() {
        return `<${this.x >= 0 ? '+' : ''}${this.x.toFixed(2)}, ${this.y >= 0 ? '+' : ''}${this.y.toFixed(2)}>`;
    }
}

/**
 * Math utilities mirroring Maths.kt
 */

/** smoothstep. Ken Perlin's version */
export function smooth(x) {
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Inverted smoothstep */
export function invsmoothish(x) {
    return 0.25 * (Math.pow(2 * x - 1, 5) + 1) + 0.5 * x;
}

/** Compute the fraction that progress represents between start and end (inverse of lerp). */
export function lexp(start, end, progress) {
    return (progress - start) / (end - start);
}

/** Exponentially smooth current toward target by a factor of speed. */
export function expSmooth(current, target, dt = 1 / 60, speed = 5) {
    return current + (target - current) * (1 - Math.exp(-dt * speed));
}

/** Standard linear interpolation */
export function lerp(start, end, fraction) {
    return start + (end - start) * fraction;
}

/** Clamps value between min and max */
export function clamp(value, minVal, maxVal) {
    return Math.max(minVal, Math.min(maxVal, value));
}

