/**
 * client/src/market/geo.js — small geometry helpers for the market map (R102). Pure.
 */

/** A circle as a GeoJSON polygon (MapLibre has no native geographic circle). */
export function circlePolygon(lat, lng, radiusKm, steps = 64) {
    const coords = [];
    const dLat = radiusKm / 111.32;
    const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

/** Zoom that roughly fits a radius in a ~520 px tall map. */
export function zoomForRadius(radiusKm) {
    return Math.max(8, Math.min(14, 13.2 - Math.log2(Math.max(radiusKm, 1) / 1.5)));
}
