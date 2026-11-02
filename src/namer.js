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

// Port of com.android.egg.landroid.Namer.kt and res/values/landroid_strings.xml

import { Bag, RandomTable } from './randomness.js';

// --------------- String arrays from landroid_strings.xml ---------------

const PLANET_DESCRIPTORS = [
    "earthy","swamp","frozen","grassy","arid","crowded","ancient","lively","homey","modern",
    "boring","compact","expensive","polluted","rusty","sandy","undulating","verdant","tessellated",
    "hollow","scalding","hemispherical","oblong","oblate","vacuum","high-pressure","low-pressure",
    "plastic","metallic","burned-out","bucolic","polyhedral"
];

const LIFE_DESCRIPTORS = [
    "aggressive","passive-aggressive","shy","timid","nasty","brutish","short","absent","teen-aged",
    "confused","transparent","cubic","quadratic","higher-order","huge","tall","wary","loud",
    "yodeling","purring","slender","cats","adorable","eclectic","electric","microscopic","trunkless",
    "myriad","cantankerous","gargantuan","contagious","fungal","cattywampus","spatchcocked",
    "rotisserie","farm-to-table","organic","synthetic","unfocused","focused","capitalist",
    "communal","bossy","malicious","compliant","psychic","oblivious","passive","bonsai","enormous"
];

const ANY_DESCRIPTORS = [
    "silly","dangerous","vast","invisible","superfluous","superconducting","superior","alien",
    "phantom","friendly","peaceful","lonely","uncomfortable","charming","fractal","imaginary",
    "forgotten","tardy","gassy","fungible","bespoke","artisanal","exceptional","puffy","rusty",
    "fresh","crusty","glossy","lovely","processed","macabre","reticulated","shocking","void",
    "undefined","gothic","beige","mid","milquetoast","melancholy","unnerving","cheery","vibrant",
    "heliotrope","psychedelic","nondescript","indescribable","tubular","toroidal","voxellated",
    "low-poly","low-carb","100% cotton","synthetic","boot-cut","bell-bottom","bumpy","fluffy",
    "sous-vide","tepid","upcycled","sous-vide","bedazzled","ancient","inexplicable","sparkling",
    "still","lemon-scented","eccentric","tilted","pungent","pine-scented","corduroy",
    "overengineered","bioengineered","impossible","commercial","cooked","pumpkin-spiced",
    "salted","minty","textured","shaded","dithered","unsequenced","super-effective"
];

const PLANET_TYPES = [
    "planet","planetoid","moon","moonlet","centaur","asteroid","space garbage","detritus",
    "satellite","core","giant","body","slab","rock","husk","planemo","object","planetesimal",
    "exoplanet","ploonet"
];

const ATMO_DESCRIPTORS = [
    "toxic","breathable","radioactive","clear","calm","peaceful","vacuum","stormy","freezing",
    "burning","humid","tropical","cloudy","obscured","damp","dank","clammy","frozen",
    "contaminated","temperate","moist","minty","relaxed","skunky","breezy","soup","glitter"
];

const CONSTELLATIONS = [
    "Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn",
    "Aquarius","Pisces","Andromeda","Cygnus","Draco","Alcor","Calamari","Neko","Monoceros",
    "Norma","Abnorma","Morel","Redlands","Cupcake","Donut","Eclair","Froyo","Gingerbread",
    "Honeycomb","Icecreamsandwich","Jellybean","Kitkat","Lollipop","Marshmallow","Nougat",
    "Oreo","Pie","Quincetart","Redvelvetcake","Snowcone","Tiramisu","Upsidedowncake",
    "Vanillaicecream","Android","Binder","Campanile","Dread","Eridani","Baklava","Cinnamonbun"
];

const CONSTELLATIONS_RARE = [
    "Jandycane","Zombiegingerbread","Astro","Bender","Flan","Untitled-1","Expedit","Petitfour",
    "Worcester","Xylophone","Yellowpeep","Zebraball","Hutton","Klang","Frogblast","Exo",
    "Keylimepie","Nov","Nrp","Waffle","Helloworld","Cuckoo"
];

const STAR_SUFFIXES = [
    "Alpha","Beta","Gamma","Delta","Epsilon","Zeta","Eta","Theta","Iota","Kappa","Lambda","Mu",
    "Nu","Xi","Omicron","Pi","Rho","Sigma","Tau","Upsilon","Phi","Chi","Psi","Omega",
    "Prime","Segundo","Major","Minor","Diminished","Augmented","Ultima","Penultima","Mid",
    "Proxima","Novis","Plus"
];

const STAR_SUFFIXES_RARE = [
    "Serif","Sans","Oblique","Grotesque","Handtooled","III \"Trey\"","Alfredo","2.0",
    "(Final)","(Final (Final))","(Draft)","Con Carne"
];

const FAUNA_GENERIC_PLURALS = [
    "fauna","animals","locals","creatures","critters","wildlife","specimens","life","cells","agents"
];

const FLORA_GENERIC_PLURALS = [
    "flora","plants","flowers","trees","mosses","specimens","life","cells","spores","fungi","nuts","algae"
];

const ATMO_GENERIC_PLURALS = ["air","atmosphere","clouds","atmo","gases"];

const ACTIVITIES = [
    "refueling","sightseeing","vacationing","luncheoning","recharging","taking up space",
    "reticulating space splines","using facilities","spelunking","repairing",
    "herding {fauna}","taming {fauna}","breeding {fauna}","singing lullabies to {fauna}",
    "singing lullabies to {flora}","singing lullabies to the {planet}","gardening {flora}",
    "collecting {flora}","surveying the {planet}","mapping the {planet}","breathing {atmo}",
    "reprocessing {atmo}","bottling {atmo}","dithering","petting {fauna}","petting {flora}",
    "grafting {flora}","healing","rehearsing","vibing","[REDACTED]"
];

// --------------- Namer (ports Namer.kt) ---------------

const SUFFIX_PROB  = 0.75;
const LETTER_PROB  = 0.30;
const NUMBER_PROB  = 0.30;
const RARE_PROB    = 0.05;

export class Namer {
    constructor() {
        this.planetDescriptors  = new Bag(PLANET_DESCRIPTORS);
        this.lifeDescriptors    = new Bag(LIFE_DESCRIPTORS);
        this.anyDescriptors     = new Bag(ANY_DESCRIPTORS);
        this.atmoDescriptors    = new Bag(ATMO_DESCRIPTORS);
        this.planetTypes        = new Bag(PLANET_TYPES);
        this.constellations     = new Bag(CONSTELLATIONS);
        this.constellationsRare = new Bag(CONSTELLATIONS_RARE);
        this.suffixes           = new Bag(STAR_SUFFIXES);
        this.suffixesRare       = new Bag(STAR_SUFFIXES_RARE);
        this.activities         = new Bag(ACTIVITIES);
        this.floraGenericPlurals = new Bag(FLORA_GENERIC_PLURALS);
        this.faunaGenericPlurals = new Bag(FAUNA_GENERIC_PLURALS);
        this.atmoGenericPlurals  = new Bag(ATMO_GENERIC_PLURALS);

        this.planetTable        = new RandomTable([0.75, this.planetDescriptors], [0.25, this.anyDescriptors]);
        this.lifeTable          = new RandomTable([0.75, this.lifeDescriptors],   [0.25, this.anyDescriptors]);
        this.constellationsTable = new RandomTable([RARE_PROB, this.constellationsRare], [1 - RARE_PROB, this.constellations]);
        this.suffixesTable      = new RandomTable([RARE_PROB, this.suffixesRare], [1 - RARE_PROB, this.suffixes]);
        this.atmoTable          = new RandomTable([0.75, this.atmoDescriptors],   [0.25, this.anyDescriptors]);
        this.delimiterTable     = new RandomTable(
            [15, " "], [3, "-"], [1, "_"], [1, "/"], [1, "."], [1, "*"], [1, "^"], [1, "#"], [0.1, "(^*!%@##!!"]
        );
    }

    // Port of Namer.describePlanet
    describePlanet(rng) {
        return this.planetTable.roll(rng).pull(rng) + " " + this.planetTypes.pull(rng);
    }

    // Port of Namer.describeLife
    describeLife(rng) {
        return this.lifeTable.roll(rng).pull(rng);
    }

    // Port of Namer.nameSystem
    nameSystem(rng) {
        let parts = this.constellationsTable.roll(rng).pull(rng);
        if (rng.nextFloat() <= SUFFIX_PROB) {
            parts += this.delimiterTable.roll(rng);
            parts += this.suffixesTable.roll(rng).pull(rng);
            if (rng.nextFloat() <= RARE_PROB) {
                parts += ' ';
                parts += this.suffixesRare.pull(rng);
            }
        }
        if (rng.nextFloat() <= LETTER_PROB) {
            parts += this.delimiterTable.roll(rng);
            parts += String.fromCharCode(65 + rng.nextIntRange(0, 26)); // 'A' + 0..25
            if (rng.nextFloat() <= RARE_PROB) {
                parts += this.delimiterTable.roll(rng);
            }
        }
        if (rng.nextFloat() <= NUMBER_PROB) {
            parts += this.delimiterTable.roll(rng);
            parts += rng.nextIntRange(2, 5039);
        }
        return parts;
    }

    // Port of Namer.describeAtmo
    describeAtmo(rng) {
        return this.atmoTable.roll(rng).pull(rng);
    }

    // Port of Namer.describeActivity
    describeActivity(rng, planet) {
        const template = this.activities.pull(rng);
        return template.replace(/\{(flora|fauna|planet|atmo)\}/g, (_, tag) => {
            switch (tag) {
                case 'flora':  return (planet?.flora ?? "SOME")       + " " + this.floraGenericPlurals.pull(rng);
                case 'fauna':  return (planet?.fauna ?? "SOME")       + " " + this.faunaGenericPlurals.pull(rng);
                case 'atmo':   return (planet?.atmosphere ?? "SOME")  + " " + this.atmoGenericPlurals.pull(rng);
                case 'planet': return planet?.description ?? "SOME BODY";
                default:       return `unknown template tag: {${tag}}`;
            }
        });
    }
}

