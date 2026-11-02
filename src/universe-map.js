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

// Universe Map: Google-Maps-style interactive exploration of the procedurally generated universe
// Powered by Leaflet.js with L.CRS.Simple for flat Cartesian 2D space coordinates [-200,000, +200,000]

import { UNIVERSE_RANGE } from './universe.js';

let map = null;
let gridLayer = null;
let orbitLayerGroup = null;
let markerLayerGroup = null;
let trackPolyline = null;
let shipMarker = null;
let starMarker = null;
let planetMarkers = [];
let universeRef = null;
let resumeCallback = null;

/**
 * Format large number coordinates with sign and padded formatting
 */
function fmtCoord(n) {
    const rounded = Math.round(n);
    const sign = rounded >= 0 ? '+' : '-';
    return `${sign}${Math.abs(rounded).toLocaleString()}`;
}

/**
 * Generate a procedural deep-space grid tile layer
 */
function createSpaceGridLayer(L) {
    const SpaceGrid = L.GridLayer.extend({
        createTile: function (coords) {
            const tile = document.createElement('canvas');
            const tileSize = this.getTileSize();
            tile.width = tileSize.x;
            tile.height = tileSize.y;
            const ctx = tile.getContext('2d');

            // Background
            ctx.fillStyle = '#16161D';
            ctx.fillRect(0, 0, tileSize.x, tileSize.y);

            // Calculate world coordinates for this tile
            const nwPoint = coords.scaleBy(tileSize);
            const sePoint = nwPoint.add(tileSize);
            const nw = this._map.unproject(nwPoint, coords.z);
            const se = this._map.unproject(sePoint, coords.z);

            const xMin = Math.min(nw.lng, se.lng);
            const xMax = Math.max(nw.lng, se.lng);
            const yMin = Math.min(nw.lat, se.lat);
            const yMax = Math.max(nw.lat, se.lat);

            // Scale-dependent grid spacing
            const worldSpan = xMax - xMin;
            let gridStep = 5000;
            if (worldSpan > 150000) gridStep = 50000;
            else if (worldSpan > 60000) gridStep = 20000;
            else if (worldSpan > 25000) gridStep = 10000;
            else if (worldSpan > 8000)  gridStep = 2500;
            else if (worldSpan > 2000)  gridStep = 500;
            else gridStep = 100;

            // Draw coordinate grid lines
            const startX = Math.floor(xMin / gridStep) * gridStep;
            ctx.lineWidth = 1;

            for (let x = startX; x <= xMax; x += gridStep) {
                const pt = this._map.project(L.latLng(0, x), coords.z).subtract(nwPoint);
                const isMajor = (x === 0 || x % (gridStep * 5) === 0);
                ctx.strokeStyle = isMajor ? 'rgba(90, 95, 140, 0.45)' : 'rgba(45, 48, 70, 0.35)';
                ctx.beginPath();
                ctx.moveTo(pt.x, 0);
                ctx.lineTo(pt.x, tileSize.y);
                ctx.stroke();

                // Axis label
                if (isMajor && pt.x >= 2 && pt.x <= tileSize.x - 40) {
                    ctx.fillStyle = 'rgba(183, 183, 255, 0.35)';
                    ctx.font = '9px monospace';
                    ctx.fillText(`X:${x / 1000}k`, pt.x + 3, 11);
                }
            }

            const startY = Math.floor(yMin / gridStep) * gridStep;
            for (let y = startY; y <= yMax; y += gridStep) {
                const pt = this._map.project(L.latLng(y, 0), coords.z).subtract(nwPoint);
                const isMajor = (y === 0 || y % (gridStep * 5) === 0);
                ctx.strokeStyle = isMajor ? 'rgba(90, 95, 140, 0.45)' : 'rgba(45, 48, 70, 0.35)';
                ctx.beginPath();
                ctx.moveTo(0, pt.y);
                ctx.lineTo(tileSize.x, pt.y);
                ctx.stroke();

                if (isMajor && pt.y >= 12 && pt.y <= tileSize.y - 4) {
                    ctx.fillStyle = 'rgba(183, 183, 255, 0.35)';
                    ctx.font = '9px monospace';
                    ctx.fillText(`Y:${y / 1000}k`, 3, pt.y - 3);
                }
            }

            // Pseudo-random deterministic background stars per tile
            const tileSeed = Math.sin(coords.x * 12.9898 + coords.y * 78.233 + coords.z * 37.719) * 43758.5453;
            let rngState = Math.abs(Math.floor(tileSeed * 100000));
            const numStars = 18;
            for (let i = 0; i < numStars; i++) {
                rngState = (rngState * 1664525 + 1013904223) % 4294967296;
                const sx = (rngState % 1000) / 1000 * tileSize.x;
                rngState = (rngState * 1664525 + 1013904223) % 4294967296;
                const sy = (rngState % 1000) / 1000 * tileSize.y;
                rngState = (rngState * 1664525 + 1013904223) % 4294967296;
                const brightness = 0.15 + ((rngState % 100) / 100) * 0.45;
                const r = ((rngState % 10) > 8) ? 1.5 : 0.8;

                ctx.fillStyle = `rgba(200, 215, 255, ${brightness})`;
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.fill();
            }

            return tile;
        }
    });

    return new SpaceGrid({
        minZoom: -9,
        maxZoom: 2,
        tileSize: 256,
        updateWhenIdle: false,
        updateInterval: 100
    });
}

/**
 * Initialize the Leaflet universe map
 */
export function initUniverseMap(universe, onResumeCockpit) {
    if (typeof L === 'undefined') {
        console.error('Leaflet library (L) is not loaded yet');
        return;
    }

    universeRef = universe;
    resumeCallback = onResumeCockpit;

    const mapContainer = document.getElementById('leaflet-map');
    if (!mapContainer) return;

    // Destroy existing instance if any
    if (map) {
        map.remove();
        map = null;
    }

    // Configure CRS.Simple bounds
    const maxBoundCoord = UNIVERSE_RANGE * 1.15;
    const universeBounds = L.latLngBounds(
        [-maxBoundCoord, -maxBoundCoord],
        [maxBoundCoord, maxBoundCoord]
    );

    map = L.map('leaflet-map', {
        crs: L.CRS.Simple,
        minZoom: -9,
        maxZoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        attributionControl: false,
        maxBounds: universeBounds,
        maxBoundsViscosity: 0.85,
        wheelPxPerZoomLevel: 90
    });

    // Add deep space grid tile layer
    gridLayer = createSpaceGridLayer(L);
    gridLayer.addTo(map);

    // Layer groups for clean management
    orbitLayerGroup = L.layerGroup().addTo(map);
    markerLayerGroup = L.layerGroup().addTo(map);

    // Universe boundary circle (dashed red perimeter at R = 200,000)
    L.circle([0, 0], {
        radius: UNIVERSE_RANGE,
        color: '#FF4466',
        weight: 1.5,
        dashArray: '8, 12',
        fill: false,
        interactive: false
    }).addTo(orbitLayerGroup);

    // Mousemove coordinate tracking in HUD header
    const coordDisplay = document.getElementById('map-coords-readout');
    map.on('mousemove', (e) => {
        if (coordDisplay) {
            const x = Math.round(e.latlng.lng);
            const y = Math.round(e.latlng.lat);
            coordDisplay.textContent = `COORDS: X: ${fmtCoord(x)} | Y: ${fmtCoord(y)}`;
        }
    });

    // Populate initial entities
    renderUniverseEntities();

    // Default view: center on spacecraft
    const ship = universe.ship;
    map.setView([ship.pos.y, ship.pos.x], -7);
}

/**
 * Re-render all entities, markers, orbits, and track lines
 */
export function renderUniverseEntities() {
    if (!map || !universeRef) return;

    orbitLayerGroup.clearLayers();
    markerLayerGroup.clearLayers();
    planetMarkers = [];

    // 1. Redraw Universe boundary ring
    L.circle([0, 0], {
        radius: UNIVERSE_RANGE,
        color: '#FF4466',
        weight: 1.5,
        dashArray: '8, 12',
        fill: false,
        interactive: false
    }).addTo(orbitLayerGroup);

    // 2. Orbits for each planet
    for (const planet of universeRef.planets) {
        L.circle([0, 0], {
            radius: planet.orbitRadius,
            color: '#343852',
            weight: 1,
            dashArray: '4, 10',
            fill: false,
            interactive: false
        }).addTo(orbitLayerGroup);
    }

    // 3. Central Star Marker
    const star = universeRef.star;
    const starIcon = L.divIcon({
        className: 'star-map-icon',
        html: `
            <div class="star-glow" style="--star-color: ${star.color};">
                <div class="star-core"></div>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });

    starMarker = L.marker([0, 0], { icon: starIcon }).addTo(markerLayerGroup);
    starMarker.bindTooltip(`☀️ <b>${star.name}</b> [Class ${star.cls}]`, {
        direction: 'top',
        className: 'celestial-tooltip',
        offset: [0, -18]
    });

    const starPopupContent = `
        <div class="celestial-popup star-popup">
            <div class="popup-header">
                <span class="popup-tag">PRIMARY STAR</span>
                <span class="popup-title">${star.name}</span>
            </div>
            <div class="popup-grid">
                <div class="grid-item"><span class="k">SPECTRAL CLASS</span><span class="v">${star.cls}</span></div>
                <div class="grid-item"><span class="k">SOLAR RADIUS</span><span class="v">${Math.round(star.radius).toLocaleString()} m</span></div>
                <div class="grid-item"><span class="k">SOLAR MASS</span><span class="v">${star.mass.toExponential(3)} kg</span></div>
                <div class="grid-item"><span class="k">BODIES ORBITING</span><span class="v">${universeRef.planets.length} Major Planets</span></div>
                <div class="grid-item full"><span class="k">COORDINATES</span><span class="v">&lt;0, 0&gt; (Origin)</span></div>
            </div>
            <div class="popup-actions">
                <button class="popup-btn" id="btn-zoom-star">🎯 CENTER ON STAR</button>
            </div>
        </div>
    `;
    starMarker.bindPopup(starPopupContent, { className: 'sci-fi-popup' });
    starMarker.on('popupopen', () => {
        const btn = document.getElementById('btn-zoom-star');
        if (btn) btn.onclick = () => map.flyTo([0, 0], -4, { duration: 1.2 });
    });

    // 4. Planet Markers
    universeRef.planets.forEach((planet, idx) => {
        const isExplored = planet.explored;
        const color = planet.color || '#FFFFFF';
        const displayRadius = Math.max(12, Math.min(30, Math.round(planet.radius / 80)));

        const planetIcon = L.divIcon({
            className: 'planet-map-icon',
            html: `
                <div class="planet-marker-body ${isExplored ? 'surveyed' : ''}"
                     style="--planet-color: ${color}; width: ${displayRadius}px; height: ${displayRadius}px;">
                    <div class="planet-inner"></div>
                    <div class="planet-ring-marker"></div>
                </div>
                <span class="planet-label">${planet.name}</span>
            `,
            iconSize: [displayRadius, displayRadius],
            iconAnchor: [displayRadius / 2, displayRadius / 2]
        });

        const pMarker = L.marker([planet.pos.y, planet.pos.x], { icon: planetIcon }).addTo(markerLayerGroup);
        pMarker.bindTooltip(`🪐 <b>${planet.name}</b> ${isExplored ? '✓ SURVEYED' : '?' }`, {
            direction: 'top',
            className: 'celestial-tooltip',
            offset: [0, -displayRadius / 2 - 4]
        });

        const planetPopupContent = `
            <div class="celestial-popup planet-popup">
                <div class="popup-header">
                    <span class="popup-tag ${isExplored ? 'tag-surveyed' : 'tag-unexplored'}">
                        ${isExplored ? '✓ SURVEYED' : '◯ UNEXPLORED'}
                    </span>
                    <span class="popup-title">${planet.name}</span>
                </div>
                <div class="popup-grid">
                    <div class="grid-item"><span class="k">TYPE</span><span class="v">${capitalize(planet.description) || 'Terrestrial'}</span></div>
                    <div class="grid-item"><span class="k">ORBIT RADIUS</span><span class="v">${Math.round(planet.orbitRadius).toLocaleString()} m</span></div>
                    <div class="grid-item"><span class="k">PLANET RADIUS</span><span class="v">${Math.round(planet.radius).toLocaleString()} m</span></div>
                    <div class="grid-item"><span class="k">PLANET MASS</span><span class="v">${planet.mass.toExponential(2)} kg</span></div>
                    <div class="grid-item"><span class="k">ORBITAL SPEED</span><span class="v">${Math.round(planet.speed).toLocaleString()} m/s</span></div>
                    <div class="grid-item"><span class="k">ATMOSPHERE</span><span class="v">${capitalize(planet.atmosphere) || 'None'}</span></div>
                    <div class="grid-item"><span class="k">FAUNA</span><span class="v">${capitalize(planet.fauna) || 'None'}</span></div>
                    <div class="grid-item"><span class="k">FLORA</span><span class="v">${capitalize(planet.flora) || 'None'}</span></div>
                    <div class="grid-item full"><span class="k">COORDINATES</span><span class="v">&lt;${fmtCoord(planet.pos.x)}, ${fmtCoord(planet.pos.y)}&gt;</span></div>
                </div>
                <div class="popup-actions">
                    <button class="popup-btn" id="btn-zoom-p-${idx}">🎯 TARGET & ZOOM IN</button>
                </div>
            </div>
        `;
        pMarker.bindPopup(planetPopupContent, { className: 'sci-fi-popup' });
        pMarker.on('popupopen', () => {
            const btn = document.getElementById(`btn-zoom-p-${idx}`);
            if (btn) btn.onclick = () => map.flyTo([planet.pos.y, planet.pos.x], -3, { duration: 1.2 });
        });

        planetMarkers.push(pMarker);
    });

    // 5. Flight Track Trail (historical path)
    if (universeRef.track && universeRef.track.length > 1) {
        const trackLatLngs = universeRef.track.map(v => [v.y, v.x]);
        trackPolyline = L.polyline(trackLatLngs, {
            color: '#00E5FF',
            weight: 2,
            opacity: 0.65,
            dashArray: '3, 6'
        }).addTo(markerLayerGroup);
    }

    // 6. Spacecraft Marker
    const ship = universeRef.ship;
    const shipDeg = (ship.angle * 180 / Math.PI) + 90; // SVG points up
    const shipIcon = L.divIcon({
        className: 'ship-map-icon',
        html: `
            <div class="ship-marker-wrapper">
                <div class="ship-radar-ping"></div>
                <svg class="ship-svg" viewBox="0 0 24 24" style="transform: rotate(${shipDeg}deg);">
                    <polygon points="12,2 22,22 12,17 2,22" fill="#00FFFF" stroke="#FFFFFF" stroke-width="1.5" />
                </svg>
            </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    });

    shipMarker = L.marker([ship.pos.y, ship.pos.x], { icon: shipIcon, zIndexOffset: 1000 }).addTo(markerLayerGroup);
    shipMarker.bindTooltip(`🚀 <b>SPACECRAFT</b> (YOU ARE HERE)`, {
        direction: 'top',
        permanent: true,
        className: 'ship-tooltip',
        offset: [0, -18]
    });

    const isLanded = !!ship.landing;
    const closest = universeRef.closestPlanet();
    const distToClosest = Math.max(0, closest.pos.minus(ship.pos).mag() - closest.radius);

    const shipPopupContent = `
        <div class="celestial-popup ship-popup">
            <div class="popup-header">
                <span class="popup-tag tag-ship">MISSION ACTIVE</span>
                <span class="popup-title">SPACECRAFT COCKPIT</span>
            </div>
            <div class="popup-grid">
                <div class="grid-item full"><span class="k">FLIGHT STATUS</span><span class="v highlight">${isLanded ? `LANDED ON ${ship.landing.planet.name.toUpperCase()}` : 'IN ORBIT / FLIGHT'}</span></div>
                <div class="grid-item"><span class="k">VELOCITY</span><span class="v">${Math.round(ship.velocity.mag())} m/s</span></div>
                <div class="grid-item"><span class="k">CURRENT THRUST</span><span class="v">${Math.round(ship.thrust.mag() * 100)}%</span></div>
                <div class="grid-item"><span class="k">NEAREST BODY</span><span class="v">${closest.name}</span></div>
                <div class="grid-item"><span class="k">ALTITUDE</span><span class="v">${Math.round(distToClosest).toLocaleString()} m</span></div>
                <div class="grid-item full"><span class="k">CURRENT POSITION</span><span class="v">&lt;${fmtCoord(ship.pos.x)}, ${fmtCoord(ship.pos.y)}&gt;</span></div>
            </div>
            <div class="popup-actions">
                <button class="popup-btn highlight-btn" id="btn-resume-from-ship">🚀 RETURN TO COCKPIT</button>
            </div>
        </div>
    `;
    shipMarker.bindPopup(shipPopupContent, { className: 'sci-fi-popup' });
    shipMarker.on('popupopen', () => {
        const btn = document.getElementById('btn-resume-from-ship');
        if (btn && resumeCallback) btn.onclick = resumeCallback;
    });

    // Populate quick-jump selector
    updatePlanetSelector();
}

/**
 * Update the top bar quick-jump dropdown
 */
function updatePlanetSelector() {
    const selector = document.getElementById('map-jump-select');
    if (!selector || !universeRef) return;

    selector.innerHTML = '<option value="">-- JUMP TO OBJECT --</option>';

    // Add Ship
    const shipOpt = document.createElement('option');
    shipOpt.value = 'ship';
    shipOpt.textContent = '🚀 Spacecraft (Current Position)';
    selector.appendChild(shipOpt);

    // Add Star
    const starOpt = document.createElement('option');
    starOpt.value = 'star';
    starOpt.textContent = `☀️ ${universeRef.star.name} (Primary Star)`;
    selector.appendChild(starOpt);

    // Add Planets
    universeRef.planets.forEach((planet, idx) => {
        const opt = document.createElement('option');
        opt.value = `planet-${idx}`;
        opt.textContent = `🪐 ${planet.name} [${planet.explored ? 'Surveyed' : 'Unexplored'}]`;
        selector.appendChild(opt);
    });

    selector.onchange = (e) => {
        const val = e.target.value;
        if (!val || !map) return;

        if (val === 'ship') {
            map.flyTo([universeRef.ship.pos.y, universeRef.ship.pos.x], -5, { duration: 1.2 });
            shipMarker.openPopup();
        } else if (val === 'star') {
            map.flyTo([0, 0], -5, { duration: 1.2 });
            starMarker.openPopup();
        } else if (val.startsWith('planet-')) {
            const idx = parseInt(val.split('-')[1], 10);
            const p = universeRef.planets[idx];
            if (p && planetMarkers[idx]) {
                map.flyTo([p.pos.y, p.pos.x], -3, { duration: 1.2 });
                planetMarkers[idx].openPopup();
            }
        }
        selector.value = '';
    };
}

/**
 * Show the universe map overlay and refresh sizing
 */
export function showUniverseMap() {
    const mapView = document.getElementById('map-view');
    if (!mapView) return;

    mapView.classList.add('active');

    if (!map && universeRef) {
        initUniverseMap(universeRef, resumeCallback);
    } else {
        renderUniverseEntities();
        setTimeout(() => {
            if (map) {
                map.invalidateSize();
                if (universeRef && universeRef.ship) {
                    map.setView([universeRef.ship.pos.y, universeRef.ship.pos.x], map.getZoom());
                }
            }
        }, 60);
    }
}

/**
 * Hide the universe map overlay
 */
export function hideUniverseMap() {
    const mapView = document.getElementById('map-view');
    if (mapView) {
        mapView.classList.remove('active');
    }
}

/**
 * Fly map view to fit the entire universe boundary
 */
export function fitEntireUniverse() {
    if (!map) return;
    map.fitBounds([[-UNIVERSE_RANGE, -UNIVERSE_RANGE], [UNIVERSE_RANGE, UNIVERSE_RANGE]], { padding: [20, 20] });
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
