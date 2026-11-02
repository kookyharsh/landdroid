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

// Port of com.android.egg.landroid.Randomness.kt and Kotlin stdlib kotlin.random.Random (XorWowRandom)

/**
 * Exact implementation of Kotlin Standard Library's XorWowRandom PRNG
 * algorithm used by kotlin.random.Random(seed: Long).
 */
export class XorWowRandom {
    constructor(seed1, seed2) {
        this.x = seed1 | 0;
        this.y = seed2 | 0;
        this.z = 0;
        this.w = 0;
        this.v = (~seed1) | 0;
        this.addend = (((seed1 << 10) ^ (seed2 >>> 4))) | 0;
        // 64 warm-up rounds per Kotlin stdlib
        for (let i = 0; i < 64; i++) {
            this.nextInt();
        }
    }

    static fromLong(seed) {
        const bigSeed = BigInt(seed);
        const seed1 = Number(BigInt.asIntN(32, bigSeed));
        const seed2 = Number(BigInt.asIntN(32, bigSeed >> 32n));
        return new XorWowRandom(seed1, seed2);
    }

    nextInt() {
        let t = this.x;
        t = (t ^ (t >>> 2)) | 0;
        this.x = this.y;
        this.y = this.z;
        this.z = this.w;
        const v0 = this.v;
        this.w = v0;
        t = (((t ^ (t << 1)) ^ v0) ^ (v0 << 4)) | 0;
        this.v = t;
        this.addend = (this.addend + 362437) | 0;
        return (t + this.addend) | 0;
    }

    nextBits(bitCount) {
        return (this.nextInt() >>> (32 - bitCount)) & ((-bitCount) >> 31);
    }

    nextFloat() {
        return this.nextBits(24) / 16777216; // 1 << 24
    }

    nextIntRange(from, until) {
        const n = (until - from) | 0;
        if (n > 0) {
            if ((n & -n) === n) {
                // power of two
                const bitCount = 31 - Math.clz32(n);
                return (from + this.nextBits(bitCount)) | 0;
            } else {
                let v;
                let bits;
                do {
                    bits = this.nextInt() >>> 1;
                    v = bits % n;
                } while ((bits - v + (n - 1)) < 0);
                return (from + v) | 0;
            }
        }
        return from;
    }

    nextFloatInRange(from, until) {
        return from + (until - from) * this.nextFloat();
    }

    choose(array) {
        return array[this.nextIntRange(0, array.length)];
    }
}

/**
 * A bag of stones mirroring Randomness.kt: Bag<T>
 * Each time you pull one out it is not replaced, preventing duplicates.
 * When exhausted, stones are replaced and reshuffled.
 */
export class Bag {
    constructor(items) {
        this.items = [...items];
        this.remaining = [...items];
        this.next = this.remaining.length; // triggers shuffle on first pull
    }

    pull(rng) {
        if (this.next >= this.remaining.length) {
            // Fisher-Yates shuffle matching Kotlin Array<T>.shuffle(random)
            for (let i = this.remaining.length - 1; i > 0; i--) {
                const j = rng.nextIntRange(0, i + 1);
                const temp = this.remaining[i];
                this.remaining[i] = this.remaining[j];
                this.remaining[j] = temp;
            }
            this.next = 0;
        }
        return this.remaining[this.next++];
    }
}

/**
 * A loot table mirroring Randomness.kt: RandomTable<T>
 * Weighted selection table.
 */
export class RandomTable {
    constructor(...pairs) {
        this.pairs = pairs;
        this.total = pairs.reduce((sum, pair) => sum + pair[0], 0);
    }

    roll(rng) {
        let x = rng.nextFloatInRange(0, this.total);
        for (const [weight, result] of this.pairs) {
            x -= weight;
            if (x < 0) return result;
        }
        return this.pairs[this.pairs.length - 1][1];
    }
}

