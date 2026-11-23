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
import { clamp, Vec2 } from './math.js';

let map = null;
let orbitLayerGroup = null;
let orbitRings = [];
let orbitZoomBand;
let viewDirty = true;
let celestialBodyLayerGroup = null;
let markerLayerGroup = null;
let trackPolyline = null;
let firstTrackPoint;
let lastTrackPoint;
let lastDetailsUpdate = -Infinity;
let shipMarker = null;
let shipRotator = null;
let lastShipLanding = null;
let starMarker = null;
let planetMarkers = [];
let planetBodyCircles = [];
let planetSurveyStates = [];
let planetDisplayPositions = [];
let zoomCorrection = null;
let cssZooming = false;
let labelZoom;
let universeRef = null;
let resumeCallback = null;
let isTrackingShip = true;
let trackingFlight = false;

const MAP_DETAILS_INTERVAL = 100;
const ZOOM_CORRECTION_DURATION = 150;
const MAP_BOUND = UNIVERSE_RANGE * 1.15;

// Clean SVGs from assets/ (currentColor)
const SVG_LOCATION = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M18.75 3.94L4.07 10.08c-.83.35-.81 1.53.02 1.85L9.43 14c.26.1.47.31.57.57l2.06 5.33c.32.84 1.51.86 1.86.03l6.15-14.67c.33-.83-.5-1.66-1.32-1.32z"/></svg>`;
const SVG_PLACE    = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><g><rect fill="none" height="24" width="24"/></g><g><path d="M12 2c-4.2 0-8 3.22-8 8.2 0 3.18 2.45 6.92 7.34 11.23.38.33.95.33 1.33 0C17.55 17.12 20 13.38 20 10.2 20 5.22 16.2 2 12 2zm0 10c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></g></svg>`;
const SVG_ROCKET   = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><g><rect fill="none" height="24" width="24"/><rect fill="none" height="24" width="24"/></g><g><path d="M11.41,2.87c0.35-0.26,0.82-0.26,1.18,0C13.81,3.75,16.5,6.46,16.5,13c0,2.16-0.78,4.76-1.36,6.35 C15,19.74,14.63,20,14.21,20l-4.41,0c-0.42,0-0.8-0.26-0.94-0.65C8.28,17.76,7.5,15.16,7.5,13C7.5,6.46,10.19,3.75,11.41,2.87z M14,11c0-1.1-0.9-2-2-2s-2,0.9-2,2s0.9,2,2,2S14,12.1,14,11z M7.69,20.52c-0.48-1.23-1.52-4.17-1.67-6.87l-1.13,0.75 C4.33,14.78,4,15.4,4,16.07v4.45c0,0.71,0.71,1.19,1.37,0.93L7.69,20.52z M20,20.52v-4.45c0-0.67-0.33-1.29-0.89-1.66l-1.13-0.75 c-0.15,2.69-1.2,5.64-1.67,6.87l2.32,0.93C19.29,21.71,20,21.23,20,20.52z"/></g></svg>`;

/**
 * Format large number coordinates with sign and padded formatting
 */
function fmtCoord(n) {
    const rounded = Math.round(n);
    const sign = rounded >= 0 ? '+' : '-';
    return `${sign}${Math.abs(rounded).toLocaleString()}`;
}

/**
 * Test whether a circle ring intersects the visible map bounding box.
 * Returns false if bounds is entirely outside the circle OR entirely inside the empty hole.
 */
export function circleIntersectsBounds(center, radius, strokeWidth, bounds) {
    if (!bounds) return true;
    const minLng = Math.min(bounds.getWest(), bounds.getEast());
    const maxLng = Math.max(bounds.getWest(), bounds.getEast());
    const minLat = Math.min(bounds.getSouth(), bounds.getNorth());
    const maxLat = Math.max(bounds.getSouth(), bounds.getNorth());

    // 1. Closest point on bounds rect to circle center
    const clampedX = Math.max(minLng, Math.min(maxLng, center.x));
    const clampedY = Math.max(minLat, Math.min(maxLat, center.y));
    const dxMin = clampedX - center.x;
    const dyMin = clampedY - center.y;
    const rOuter = radius + strokeWidth;
    if (dxMin * dxMin + dyMin * dyMin > rOuter * rOuter) {
        return false; // Bounds rect is entirely outside the circle
    }

    // 2. Farthest point on bounds rect to circle center (always one of the 4 corners)
    const maxDx = Math.max(Math.abs(minLng - center.x), Math.abs(maxLng - center.x));
    const maxDy = Math.max(Math.abs(minLat - center.y), Math.abs(maxLat - center.y));
    const rInner = Math.max(0, radius - strokeWidth);
    if (maxDx * maxDx + maxDy * maxDy < rInner * rInner) {
        return false; // Bounds rect is entirely inside the hole of the ring
    }

    return true;
}

/**
 * Dynamically updates orbit and boundary circles with viewport culling and dash clamping
 */
export function updateVisibleOrbits() {
    if (!map || !orbitLayerGroup || cssZooming) return;

    // Keep a margin so rings can enter the viewport as Leaflet pans or animates a zoom.
    const bounds = map.getBounds().pad(0.25);
    const zoom = map.getZoom();
    const isHighZoom = zoom >= -3;
    for (const { layer, radius, margin, dashArray } of orbitRings) {
        if (orbitZoomBand !== isHighZoom) layer.setStyle({ dashArray: isHighZoom ? null : dashArray });
        const visible = circleIntersectsBounds(Vec2.Zero, radius, margin, bounds);
        const attached = orbitLayerGroup.hasLayer(layer);
        if (visible && !attached) orbitLayerGroup.addLayer(layer);
        if (!visible && attached) orbitLayerGroup.removeLayer(layer);
    }
    orbitZoomBand = isHighZoom;
    viewDirty = false;
    updatePlanetLabels(zoom);
}

/**
 * Dynamically adjusts celestial body label offsets so labels always hug the outer boundary of discs
 */
export function updatePlanetLabels(zoom = map?.getZoom()) {
    if (!map || !universeRef) return;
    if (zoom === labelZoom) return;
    labelZoom = zoom;
    const scale = Math.pow(2, zoom);

    if (starMarker && universeRef.star) {
        const starOffset = Math.max(16, Math.round(universeRef.star.radius * scale)) + 8;
        const el = starMarker.getElement();
        if (el) {
            const label = el.querySelector('.star-label');
            if (label) label.style.setProperty('--star-label-offset', `${starOffset}px`);
        }
    }

    for (let i = 0; i < universeRef.planets.length; i++) {
        const p = universeRef.planets[i];
        const m = planetMarkers[i];
        if (p && m) {
            const offset = Math.max(12, Math.round(p.radius * scale)) + 6;
            const el = m.getElement();
            if (el) {
                const label = el.querySelector('.planet-label');
                if (label) label.style.setProperty('--planet-label-offset', `${offset}px`);
            }
        }
    }
}

/**
 * Compute the display coordinates for the spacecraft marker on the map.
 * When landed on a celestial body, this guarantees that the base of the rocket icon
 * visibly rests directly on the surface of the body disc (or marker perimeter at low zoom).
 */
export function getShipMapCoords(ship, landingCenter = ship?.landing?.planet?.pos) {
    if (!ship) return [0, 0];
    if (ship.landing && ship.landing.planet && map) {
        const p = ship.landing.planet;
        const zoom = map.getZoom();
        const scale = Math.pow(2, zoom);
        const physicalPixelRadius = p.radius * scale;
        const minPixelRadius = 8;
        const rocketBaseOffsetPx = 8.5; // distance from rocket icon center to its landing feet

        let targetPixelDistance;
        if (physicalPixelRadius >= minPixelRadius) {
            targetPixelDistance = physicalPixelRadius + rocketBaseOffsetPx;
        } else {
            targetPixelDistance = minPixelRadius + rocketBaseOffsetPx;
        }

        const targetWorldDistance = targetPixelDistance / scale;
        const offset = Vec2.makeWithAngleMag(ship.landing.angle, targetWorldDistance);
        const surfacePos = landingCenter.plus(offset);
        return [surfacePos.y, surfacePos.x];
    }
    return [ship.pos.y, ship.pos.x];
}

/**
 * Calculate distance to the nearest celestial surface (primary star or planets)
 */
export function getDistanceToNearestCelestialSurface(ship, universe) {
    if (!ship || !universe) return { dist: Infinity, body: null };
    let minDist = Infinity;
    let nearestBody = null;

    // 1. Check Primary Star
    if (universe.star) {
        const dStar = Math.max(0, ship.pos.minus(universe.star.pos).mag() - universe.star.radius);
        if (dStar < minDist) {
            minDist = dStar;
            nearestBody = universe.star;
        }
    }

    // 2. Check All Planets
    if (universe.planets) {
        for (const planet of universe.planets) {
            const dPlanet = Math.max(0, ship.pos.minus(planet.pos).mag() - planet.radius);
            if (dPlanet < minDist) {
                minDist = dPlanet;
                nearestBody = planet;
            }
        }
    }

    return { dist: minDist, body: nearestBody };
}

/**
 * Calculate the ideal map zoom level based on proximity to celestial bodies.
 * Zooms in close when approaching or landed on a star or planet (-2.0 to -3.5),
 * and smoothly pulls out to wide system overview in deep space (-7.0).
 */
export function calculateDynamicMapZoom(dist, body) {
    if (dist <= 0) {
        if (body && body.radius > 3000) return -3.5;
        return -2.0;
    }

    const bodyOffset = body ? Math.min(4000, body.radius * 0.5) : 1500;
    const s = Math.min(0.25, Math.max(Math.pow(2, -7), 500 / (dist + bodyOffset)));
    const targetZ = Math.log2(s);

    return Math.max(-7.0, Math.min(-2.0, targetZ));
}

/**
 * Toggle auto-follow spacecraft mode on the universe map
 */
export function toggleTrackingShip() {
    setTrackingShip(!isTrackingShip);
}

/**
 * Enable or disable auto-follow spacecraft mode and update UI buttons
 */
export function setTrackingShip(enabled) {
    isTrackingShip = enabled;
    updateTrackButtonUI();
    if (!enabled) stopTrackingFlight();
    else if (map && universeRef?.ship) followShip(universeRef.ship, true);
}

function stopTrackingFlight() {
    if (!trackingFlight) return;
    trackingFlight = false;
    map.setView(map.getCenter(), map.getZoom(), { animate: false, noMoveStart: true });
}

function followShip(ship, recenter = false) {
    if (trackingFlight || cssZooming) return;

    const coords = getShipMapCoords(ship);
    const halfSize = map.getSize().divideBy(2);
    const zoom = map.getZoom();
    const center = trackingCenter(coords, zoom, halfSize);
    const centered = map.latLngToContainerPoint(center).distanceTo(halfSize) < 2;
    const { dist, body } = getDistanceToNearestCelestialSurface(ship, universeRef);
    const targetZoom = calculateDynamicMapZoom(dist, body);
    const zoomDelta = Math.abs(targetZoom - zoom);
    if (zoomDelta >= (recenter ? 0.125 : 0.75) || (recenter && !centered)) {
        trackingFlight = true;
        map.flyTo(trackingCenter(coords, targetZoom, halfSize), targetZoom, { duration: 0.9 });
    } else if (!centered) {
        map.panTo(center, { animate: false });
    }
}

function trackingCenter([lat, lng], zoom, halfSize) {
    // Match the largest legal camera center so tracking can settle at the map boundary.
    const scale = 2 ** zoom;
    const latLimit = Math.max(0, MAP_BOUND - halfSize.y / scale);
    const lngLimit = Math.max(0, MAP_BOUND - halfSize.x / scale);
    return [clamp(lat, -latLimit, latLimit), clamp(lng, -lngLimit, lngLimit)];
}

function unlockTrackingOnInput(container) {
    const unlock = () => {
        if (isTrackingShip) setTrackingShip(false);
    };
    const listeners = new AbortController();
    const options = { capture: true, passive: true, signal: listeners.signal };
    container.addEventListener('wheel', unlock, options);
    container.addEventListener('dblclick', unlock, options);
    container.addEventListener('touchstart', (event) => {
        if (event.touches.length === 2) unlock();
    }, options);
    container.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'touch' && !event.isPrimary) unlock();
    }, options);
    container.addEventListener('click', (event) => {
        if (event.target.closest('.leaflet-control-zoom-in, .leaflet-control-zoom-out')) unlock();
    }, options);
    container.addEventListener('keydown', (event) => {
        if (['+', '=', '-', '_', 'Add', 'Subtract', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            unlock();
        }
    }, options);
    map.on('dragstart boxzoomstart', unlock);
    map.on('unload', () => listeners.abort());
}

/**
 * Update active state styles on the track buttons
 */
export function updateTrackButtonUI() {
    const trackBtn = document.getElementById('btn-track-ship');
    const fabBtn = document.getElementById('map-my-location-fab');
    const btnText = document.getElementById('track-btn-text');

    if (trackBtn) {
        if (isTrackingShip) {
            trackBtn.classList.add('active');
            if (btnText) btnText.textContent = 'TRACK [LOCKED]';
        } else {
            trackBtn.classList.remove('active');
            if (btnText) btnText.textContent = 'TRACK SHIP';
        }
    }

    if (fabBtn) {
        if (isTrackingShip) {
            fabBtn.classList.add('active');
        } else {
            fabBtn.classList.remove('active');
        }
    }
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
        updateWhenIdle: true,
        updateWhenZooming: false,
        keepBuffer: 3
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

    if (map) {
        map.remove();
        map = null;
    }
    trackingFlight = false;
    cssZooming = false;
    orbitZoomBand = undefined;

    const universeBounds = L.latLngBounds(
        [-MAP_BOUND, -MAP_BOUND],
        [MAP_BOUND, MAP_BOUND]
    );

    map = L.map('leaflet-map', {
        crs: L.CRS.Simple,
        preferCanvas: true,
        minZoom: -9,
        maxZoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        attributionControl: false,
        maxBounds: universeBounds,
        maxBoundsViscosity: 0.85,
        wheelPxPerZoomLevel: 90
    });

    createSpaceGridLayer(L).addTo(map);
    map.createPane('orbitPane');
    map.createPane('trackPane');

    orbitLayerGroup = L.layerGroup().addTo(map);
    celestialBodyLayerGroup = L.layerGroup().addTo(map);
    markerLayerGroup = L.layerGroup().addTo(map);

    const boundary = { radius: UNIVERSE_RANGE, margin: 20, dashArray: '8, 12', color: '#800000', weight: 1.5 };
    const orbits = universe.planets.map((planet) => ({
        radius: planet.orbitRadius, margin: 10, dashArray: '4, 10', color: '#292936', weight: 1,
    }));
    orbitRings = [boundary, ...orbits].map(({ radius, margin, dashArray, color, weight }) => ({
        radius, margin, dashArray,
        layer: L.circle([0, 0], { radius, color, weight, fill: false, interactive: false, pane: 'orbitPane' }),
    }));

    map.on('move zoom viewreset resize', () => { viewDirty = true; });
    map.on('moveend', () => {
        trackingFlight = false;
        viewDirty = true;
    });
    map.on('zoomanim', (event) => {
        cssZooming = true;
        updatePlanetLabels(event.zoom);
    });
    map.on('zoomend', finishCssZoom);
    unlockTrackingOnInput(mapContainer);

    const coordDisplay = document.getElementById('map-coords-readout');
    map.on('mousemove', (e) => {
        if (coordDisplay) {
            const x = Math.round(e.latlng.lng);
            const y = Math.round(e.latlng.lat);
            coordDisplay.textContent = `COORDS: X: ${fmtCoord(x)} | Y: ${fmtCoord(y)}`;
        }
    });

    // Default view: center on spacecraft with initial dynamic zoom
    const ship = universe.ship;
    const { dist, body } = getDistanceToNearestCelestialSurface(ship, universe);
    const initialZoom = calculateDynamicMapZoom(dist, body);
    map.setView(getShipMapCoords(ship), initialZoom);

    // Setup track button listeners
    const trackBtn = document.getElementById('btn-track-ship');
    if (trackBtn) {
        trackBtn.onclick = () => toggleTrackingShip();
    }
    const fabBtn = document.getElementById('map-my-location-fab');
    if (fabBtn) {
        fabBtn.onclick = () => toggleTrackingShip();
    }
    const returnBtn = document.getElementById('btn-return-cockpit');
    if (returnBtn && resumeCallback) {
        returnBtn.onclick = resumeCallback;
    }

    // Populate initial entities
    renderUniverseEntities();
    updateTrackButtonUI();
}

/**
 * Re-render all entities, markers, orbits, and track lines
 */
export function renderUniverseEntities() {
    if (!map || !universeRef) return;

    if (celestialBodyLayerGroup) celestialBodyLayerGroup.clearLayers();
    markerLayerGroup.clearLayers();
    planetMarkers = [];
    planetBodyCircles = [];
    planetSurveyStates = [];
    planetDisplayPositions = [];
    zoomCorrection = null;

    // 2. Central Star Physical Disc and Marker
    const star = universeRef.star;
    const starBodyCircle = L.circle([0, 0], {
        radius: star.radius,
        color: '#FFFFFF',
        fillColor: star.color,
        fillOpacity: 0.95,
        weight: 2.5,
        interactive: true
    }).addTo(celestialBodyLayerGroup);

    const scale = Math.pow(2, map.getZoom());
    const starOffset = Math.max(16, Math.round(star.radius * scale)) + 8;
    const starIcon = L.divIcon({
        className: 'star-map-icon',
        html: `<span class="star-label" style="--star-label-offset: ${starOffset}px;">${star.name}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
    });

    starMarker = L.marker([0, 0], { icon: starIcon }).addTo(markerLayerGroup);
    starBodyCircle.on('click', () => starMarker.openPopup());
    starMarker.bindTooltip(`STAR: <b>${star.name}</b> [Class ${star.cls}]`, {
        direction: 'top',
        className: 'celestial-tooltip',
        offset: [0, -14]
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
                <button class="popup-btn hud-btn" id="btn-zoom-star">${SVG_LOCATION} CENTER ON STAR</button>
            </div>
        </div>
    `;
    starMarker.bindPopup(starPopupContent);
    starMarker.on('popupopen', () => {
        const btn = document.getElementById('btn-zoom-star');
        if (btn) btn.onclick = () => {
            setTrackingShip(false);
            map.flyTo([0, 0], -4, { duration: 1.2 });
        };
    });

    // 3. Planet Physical Discs and Markers
    universeRef.planets.forEach((planet, idx) => {
        const color = planet.color || '#FFFFFF';
        planetSurveyStates.push(planet.explored);
        planetDisplayPositions.push(planet.pos);

        const bodyCircle = L.circle([planet.pos.y, planet.pos.x], {
            radius: planet.radius,
            color: planetBorderColor(planet.explored),
            fillColor: color,
            fillOpacity: 0.85,
            weight: 2,
            interactive: true
        }).addTo(celestialBodyLayerGroup);
        planetBodyCircles.push(bodyCircle);

        const labelOffset = Math.max(12, Math.round(planet.radius * scale)) + 6;
        const planetIcon = L.divIcon({
            className: 'planet-map-icon',
            html: `<span class="planet-label" style="--planet-label-offset: ${labelOffset}px;">${planet.name}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
        });

        const pMarker = L.marker([planet.pos.y, planet.pos.x], { icon: planetIcon }).addTo(markerLayerGroup);
        bodyCircle.on('click', () => pMarker.openPopup());
        pMarker.bindTooltip(planetTooltip(planet), {
            direction: 'top',
            className: 'celestial-tooltip',
            offset: [0, -14]
        });

        pMarker.bindPopup(() => `
            <div class="celestial-popup planet-popup">
                <div class="popup-header">
                    <span class="popup-tag ${planet.explored ? 'tag-surveyed' : 'tag-unexplored'}" data-field="survey">${planetSurveyLabel(planet)}</span>
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
                    <div class="grid-item full"><span class="k">COORDINATES</span><span class="v" data-field="position">${formatPosition(planet.pos)}</span></div>
                </div>
                <div class="popup-actions">
                    <button class="popup-btn hud-btn" id="btn-zoom-p-${idx}">${SVG_PLACE} TARGET & ZOOM IN</button>
                </div>
            </div>
        `);
        pMarker.on('popupopen', () => {
            const btn = document.getElementById(`btn-zoom-p-${idx}`);
            if (btn) btn.onclick = () => {
                setTrackingShip(false);
                map.flyTo([planet.pos.y, planet.pos.x], -3, { duration: 1.2 });
            };
        });

        planetMarkers.push(pMarker);
    });

    // 4. Flight Track Trail (historical path)
    trackPolyline = L.polyline([], {
        pane: 'trackPane',
        interactive: false,
        color: '#34A853',
        weight: 1.5,
        opacity: 0.7,
        dashArray: '3, 6'
    }).addTo(markerLayerGroup);
    firstTrackPoint = undefined;
    lastTrackPoint = undefined;
    lastDetailsUpdate = -Infinity;

    // 5. Spacecraft Marker (Flat rocket SVG rotated to ship heading)
    const ship = universeRef.ship;
    const shipDeg = 90 - (ship.angle * 180 / Math.PI);
    const shipIcon = L.divIcon({
        className: 'ship-map-icon',
        html: `
            <div class="ship-marker-wrapper">
                <div class="ship-rotator" style="transform: rotate(${shipDeg}deg);">
                    ${SVG_ROCKET}
                </div>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    shipMarker = L.marker(getShipMapCoords(ship), { icon: shipIcon, zIndexOffset: 1000 }).addTo(markerLayerGroup);
    shipRotator = shipMarker.getElement()?.querySelector('.ship-rotator');
    lastShipLanding = ship.landing;
    shipMarker.bindTooltip(`SPACECRAFT (CURRENT POSITION)`, {
        direction: 'top',
        permanent: true,
        className: 'ship-tooltip',
        offset: [0, -14]
    });

    shipMarker.bindPopup(() => {
        const telemetry = getShipTelemetry(ship);
        return `
        <div class="celestial-popup ship-popup">
            <div class="popup-header">
                <span class="popup-tag tag-ship">MISSION ACTIVE</span>
                <span class="popup-title">SPACECRAFT TELEMETRY</span>
            </div>
            <div class="popup-grid">
                <div class="grid-item full"><span class="k">FLIGHT STATUS</span><span class="v" data-field="status">${telemetry.status}</span></div>
                <div class="grid-item"><span class="k">VELOCITY</span><span class="v" data-field="velocity">${telemetry.velocity}</span></div>
                <div class="grid-item"><span class="k">CURRENT THRUST</span><span class="v" data-field="thrust">${telemetry.thrust}</span></div>
                <div class="grid-item"><span class="k">NEAREST BODY</span><span class="v" data-field="nearest">${telemetry.nearest}</span></div>
                <div class="grid-item"><span class="k">ALTITUDE</span><span class="v" data-field="altitude">${telemetry.altitude}</span></div>
                <div class="grid-item full"><span class="k">CURRENT POSITION</span><span class="v" data-field="position">${telemetry.position}</span></div>
            </div>
            <div class="popup-actions">
                <button class="popup-btn hud-btn" id="btn-resume-from-ship">${SVG_ROCKET} RETURN TO COCKPIT</button>
            </div>
        </div>
        `;
    });
    shipMarker.on('popupopen', () => {
        const btn = document.getElementById('btn-resume-from-ship');
        if (btn && resumeCallback) btn.onclick = resumeCallback;
    });

    updatePlanetSelector();
    labelZoom = undefined;
    updateVisibleOrbits();
}

function finishCssZoom() {
    if (!cssZooming) return;
    cssZooming = false;
    viewDirty = true;
    const ship = universeRef.ship;
    const shipPosition = shipMarker.getLatLng();
    zoomCorrection = {
        startedAt: performance.now(),
        planets: planetDisplayPositions.map((position, i) => position.minus(universeRef.planets[i].pos)),
        ship: new Vec2(shipPosition.lng, shipPosition.lat).minus(ship.pos),
    };
}

function formatPosition(pos) {
    return `<${fmtCoord(pos.x)}, ${fmtCoord(pos.y)}>`;
}

function planetBorderColor(explored) {
    return explored ? '#00FF66' : '#FFFFFF';
}

function planetSurveyLabel(planet) {
    return planet.explored ? '[SURVEYED]' : '[UNEXPLORED]';
}

function planetTooltip(planet) {
    return `BODY: <b>${planet.name}</b> ${planetSurveyLabel(planet)}`;
}

function getShipTelemetry(ship) {
    const closest = universeRef.closestPlanet();
    const altitude = Math.max(0, closest.pos.distance(ship.pos) - closest.radius);
    return {
        status: getShipStatus(ship),
        velocity: `${Math.round(ship.velocity.mag())} m/s`,
        thrust: `${Math.round(ship.thrust.mag() * 100)}%`,
        nearest: closest.name,
        altitude: `${Math.round(altitude).toLocaleString()} m`,
        position: formatPosition(ship.pos),
    };
}

function getShipStatus(ship) {
    return ship.landing ? `LANDED ON ${ship.landing.planet.name.toUpperCase()}` : 'IN ORBIT / FLIGHT';
}

function updateFlightTrack(positions) {
    const lastPoint = positions.at(-1);
    if (lastPoint === lastTrackPoint) return;

    const rendered = trackPolyline.getLatLngs();
    const appended = lastTrackPoint && positions[0] === firstTrackPoint && positions[rendered.length - 1] === lastTrackPoint;
    if (appended && positions.length === rendered.length + 1) {
        trackPolyline.addLatLng([lastPoint.y, lastPoint.x]);
    } else if (appended) {
        const newPoints = positions.slice(rendered.length).map(point => [point.y, point.x]);
        trackPolyline.setLatLngs(rendered.concat(newPoints));
    } else {
        trackPolyline.setLatLngs(positions.map(point => [point.y, point.x]));
    }
    firstTrackPoint = positions[0];
    lastTrackPoint = lastPoint;
}

export function clearMapFlightTrack() {
    trackPolyline?.setLatLngs([]);
    firstTrackPoint = undefined;
    lastTrackPoint = undefined;
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
    shipOpt.textContent = 'Spacecraft (Current Position)';
    selector.appendChild(shipOpt);

    // Add Star
    const starOpt = document.createElement('option');
    starOpt.value = 'star';
    starOpt.textContent = `Star: ${universeRef.star.name} (Primary Star)`;
    selector.appendChild(starOpt);

    // Add Planets
    universeRef.planets.forEach((planet, idx) => {
        const opt = document.createElement('option');
        opt.value = `planet-${idx}`;
        opt.textContent = `Planet: ${planet.name} [${planet.explored ? 'Surveyed' : 'Unexplored'}]`;
        selector.appendChild(opt);
    });

    selector.onchange = (e) => {
        const val = e.target.value;
        if (!val || !map) return;

        if (val === 'ship') {
            setTrackingShip(true);
            shipMarker.openPopup();
        } else if (val === 'star') {
            setTrackingShip(false);
            map.flyTo([0, 0], -5, { duration: 1.2 });
            starMarker.openPopup();
        } else if (val.startsWith('planet-')) {
            setTrackingShip(false);
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
 * Live-updates the positions of all planet markers, spacecraft marker, and flight trail
 * called every frame when the universe map is active.
 */
export function updateMapPositions(timestamp = performance.now()) {
    if (!map || !universeRef) return;

    if (viewDirty) updateVisibleOrbits();
    const refreshDetails = timestamp - lastDetailsUpdate >= MAP_DETAILS_INTERVAL;
    if (refreshDetails) lastDetailsUpdate = timestamp;

    // Leaflet owns the CSS transform until zoomend. Fade out the position offset
    // afterward while the simulation continues at its normal cadence.
    let correction = 0;
    if (zoomCorrection && !cssZooming) {
        const elapsed = Math.max(0, timestamp - zoomCorrection.startedAt);
        const remaining = Math.max(0, 1 - elapsed / ZOOM_CORRECTION_DURATION);
        correction = remaining * remaining;
        if (!correction) zoomCorrection = null;
    }

    // 1. Move all planet discs and markers along their orbits
    let surveyChanged = false;
    for (let i = 0; i < universeRef.planets.length; i++) {
        const p = universeRef.planets[i];
        const m = planetMarkers[i];
        const c = planetBodyCircles[i];
        if (!cssZooming) {
            const position = correction ? p.pos.plus(zoomCorrection.planets[i].times(correction)) : p.pos;
            const previous = planetDisplayPositions[i];
            if (position.x !== previous.x || position.y !== previous.y) {
                planetDisplayPositions[i] = position;
                const coords = [position.y, position.x];
                c.setLatLng(coords);
                m.setLatLng(coords);
            }
        }
        const explored = p.explored;
        const planetSurveyChanged = planetSurveyStates[i] !== explored;
        if (planetSurveyChanged) {
            planetSurveyStates[i] = explored;
            surveyChanged = true;
            c.setStyle({ color: planetBorderColor(explored) });
            m.setTooltipContent(planetTooltip(p));
        }
        if ((planetSurveyChanged || refreshDetails) && m.isPopupOpen()) {
            const popup = m.getPopup().getElement();
            if (planetSurveyChanged) {
                const tag = popup.querySelector('[data-field="survey"]');
                tag.textContent = planetSurveyLabel(p);
                tag.classList.toggle('tag-surveyed', explored);
                tag.classList.toggle('tag-unexplored', !explored);
            }
            if (refreshDetails) {
                const field = popup.querySelector('[data-field="position"]');
                const coords = formatPosition(p.pos);
                if (field.textContent !== coords) field.textContent = coords;
            }
        }
    }
    if (surveyChanged) updatePlanetSelector();

    // 2. Move spacecraft marker and update orientation
    const ship = universeRef.ship;
    if (!cssZooming) {
        const landingIndex = universeRef.planets.indexOf(ship.landing?.planet);
        const coords = getShipMapCoords(ship, planetDisplayPositions[landingIndex]);
        if (correction && !ship.landing) {
            coords[0] += zoomCorrection.ship.y * correction;
            coords[1] += zoomCorrection.ship.x * correction;
        }
        const previous = shipMarker.getLatLng();
        if (previous.lat !== coords[0] || previous.lng !== coords[1]) shipMarker.setLatLng(coords);
        if (shipRotator) {
            const shipDeg = 90 - (ship.angle * 180 / Math.PI);
            const heading = `rotate(${shipDeg}deg)`;
            if (shipRotator.style.transform !== heading) shipRotator.style.transform = heading;
        }
    }

    const landingChanged = ship.landing !== lastShipLanding;
    lastShipLanding = ship.landing;
    if ((refreshDetails || landingChanged) && shipMarker.isPopupOpen()) {
        const popup = shipMarker.getPopup().getElement();
        if (refreshDetails) {
            const telemetry = getShipTelemetry(ship);
            for (const field of popup.querySelectorAll('[data-field]')) {
                const value = telemetry[field.dataset.field];
                if (field.textContent !== value) field.textContent = value;
            }
        } else {
            popup.querySelector('[data-field="status"]').textContent = getShipStatus(ship);
        }
    }

    // 3. Update flight trail if new positions were recorded
    if (refreshDetails && !cssZooming) updateFlightTrack(ship.track.positions);

    // 4. Auto-tracking spacecraft with dynamic zoom
    if (isTrackingShip) followShip(ship);
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
    } else if (map) {
        map.invalidateSize({ pan: false });
        lastDetailsUpdate = -Infinity;
        viewDirty = true;
        setTrackingShip(true);
    }
}

/**
 * Hide the universe map overlay
 */
export function hideUniverseMap() {
    stopTrackingFlight();
    map?.closePopup();
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
    setTrackingShip(false);
    map.fitBounds([[-UNIVERSE_RANGE, -UNIVERSE_RANGE], [UNIVERSE_RANGE, UNIVERSE_RANGE]], { padding: [20, 20] });
}

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}
