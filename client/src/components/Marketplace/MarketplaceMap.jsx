/**
 * client/src/components/Marketplace/MarketplaceMap.jsx — the buyer map, on real
 * data and free, open infrastructure (R102).
 *
 *   tiles   OpenFreeMap "positron" vector style (no key, no usage cap), MapLibre GL
 *   pins    live listings from GET /api/market/listings (studios at their address,
 *           people at a ~1 km rounded point — the server decides, see marketData.js)
 *   search  "Change location" uses our own /api/market/geocode (Photon, cached,
 *           Île-de-France only), never a third-party key in the browser
 *
 * Replaces the Leaflet + CARTO map, which drew hard-coded seed coordinates.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin, Search, X } from 'lucide-react';
import { searchAddress } from '../../market/marketApi.js';
import { circlePolygon, zoomForRadius } from '../../market/geo.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const TEAL = '#0B7C91';

function pinElement(item, selected) {
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', `${item.name}, €${item.priceHalfDay} half-day${item.distanceKm != null ? `, ${item.distanceKm} km away` : ''}`);
    el.textContent = `€${Math.round(item.priceHalfDay)}`;
    Object.assign(el.style, {
        padding: selected ? '6px 12px' : '4px 10px',
        borderRadius: '999px',
        border: `1.5px solid ${selected ? '#10151D' : 'rgba(16,21,29,0.18)'}`,
        background: selected ? '#10151D' : '#FFFFFF',
        color: selected ? '#FFFFFF' : '#10151D',
        font: '600 12px/1.2 "Geist", -apple-system, sans-serif',
        boxShadow: '0 4px 12px rgba(16,21,29,0.16)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    });
    if (!item.exactLocation) el.title = 'Shown within about 1 km';
    return el;
}

export default function MarketplaceMap({
    listings = [],
    selectedId = null,
    onSelectListing = () => {},
    radiusKm = 25,
    center = { lat: 48.8566, lng: 2.3522, label: 'Paris' },
    onChangeLocation = () => {},
    onQuickBook = () => {},
}) {
    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const markersRef = useRef([]);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    // The parent passes a new function each render; reading it through a ref
    // keeps the pins from being torn down and rebuilt on every render.
    const onSelectRef = useRef(onSelectListing);
    useEffect(() => { onSelectRef.current = onSelectListing; }, [onSelectListing]);

    // Create the map once.
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return undefined;
        let map;
        try {
            map = new maplibregl.Map({
                container: containerRef.current,
                style: STYLE_URL,
                center: [center.lng, center.lat],
                zoom: zoomForRadius(radiusKm),
                attributionControl: { compact: true },
                cooperativeGestures: false,
            });
        } catch (err) {
            console.error('[MarketplaceMap] map failed to start:', err.message);
            setFailed(true);
            return undefined;
        }
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
        map.on('load', () => {
            map.addSource('radius', { type: 'geojson', data: circlePolygon(center.lat, center.lng, radiusKm) });
            map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': TEAL, 'fill-opacity': 0.06 } });
            map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': TEAL, 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [2, 2] } });
            setReady(true);
        });
        map.on('error', (e) => console.warn('[MarketplaceMap] map error:', e?.error?.message || e));
        mapRef.current = map;
        return () => { map.remove(); mapRef.current = null; };
        // The map is created once; centre and radius changes are applied below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Centre and radius.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;
        map.getSource('radius')?.setData(circlePolygon(center.lat, center.lng, radiusKm));
        map.easeTo({ center: [center.lng, center.lat], zoom: zoomForRadius(radiusKm), duration: 600 });
    }, [center.lat, center.lng, radiusKm, ready]);

    // Pins.
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !ready) return;
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = listings
            .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
            .map((item) => {
                const el = pinElement(item, item.id === selectedId);
                el.addEventListener('click', (e) => { e.stopPropagation(); onSelectRef.current(item.id); });
                return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([item.lng, item.lat]).addTo(map);
            });
    }, [listings, selectedId, ready]);

    const selected = useMemo(() => listings.find((l) => l.id === selectedId) || null, [listings, selectedId]);

    return (
        <div style={{ position: 'relative', height: 520, borderRadius: 18, overflow: 'hidden', border: '1px solid rgba(16,21,29,0.1)', background: '#EEF0F3' }}>
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-label="Map of live listings" />

            <LocationSearch center={center} onPick={onChangeLocation} />

            {failed && (
                <div style={overlayNote}>The map could not load in this browser. The list above still shows every listing.</div>
            )}
            {!failed && ready && listings.length === 0 && (
                <div style={overlayNote}>No live listings within {radiusKm} km of {center.label} yet. Try a wider radius.</div>
            )}

            {selected && (
                <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, maxWidth: 420, background: '#fff', borderRadius: 14, padding: '14px 16px', boxShadow: '0 12px 32px rgba(16,21,29,0.18)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: '#10151D', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected.name}</div>
                        <div style={{ fontSize: 12.5, color: '#5F6876' }}>
                            {selected.kind} · {selected.location}{selected.distanceKm != null ? ` · ${selected.distanceKm} km` : ''} · €{selected.priceHalfDay} half-day
                        </div>
                    </div>
                    <button type="button" onClick={() => onQuickBook(selected)} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: TEAL, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Request</button>
                </div>
            )}
        </div>
    );
}

const overlayNote = {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxWidth: 360,
    background: 'rgba(255,255,255,0.95)', borderRadius: 12, padding: '12px 16px', textAlign: 'center',
    color: '#3D4553', fontSize: 13.5, boxShadow: '0 8px 24px rgba(16,21,29,0.12)', pointerEvents: 'none',
};

/** "Change location": address search through our server, Île-de-France only. */
function LocationSearch({ center, onPick }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [places, setPlaces] = useState([]);
    const [state, setState] = useState('idle'); // idle | searching | empty | error

    useEffect(() => {
        if (!open || q.trim().length < 3) return undefined;
        const t = setTimeout(async () => {
            setState('searching');
            const r = await searchAddress(q);
            if (!r.ok) { setPlaces([]); setState('error'); return; }
            setPlaces(r.places || []);
            setState((r.places || []).length ? 'idle' : 'empty');
        }, 350);
        return () => clearTimeout(t);
    }, [q, open]);

    return (
        <div style={{ position: 'absolute', top: 14, left: 14, right: 14, maxWidth: 380, zIndex: 2 }}>
            {!open ? (
                <button type="button" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(16,21,29,0.12)', background: '#fff', color: '#10151D', fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 14px rgba(16,21,29,0.1)' }}>
                    <MapPin size={14} color={TEAL} /> Near {center.label} · change
                </button>
            ) : (
                <div style={{ background: '#fff', borderRadius: 14, boxShadow: '0 10px 30px rgba(16,21,29,0.16)', padding: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px' }}>
                        <Search size={15} color="#5F6876" aria-hidden="true" />
                        <label htmlFor="mk-map-search" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search an address or town in Île-de-France</label>
                        <input id="mk-map-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Address or town in Île-de-France"
                            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, padding: '6px 0', minWidth: 0 }} />
                        <button type="button" aria-label="Close search" onClick={() => { setOpen(false); setQ(''); setPlaces([]); setState('idle'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5F6876' }}><X size={15} /></button>
                    </div>
                    {state === 'searching' && <div style={hint}>Searching…</div>}
                    {state === 'empty' && <div style={hint}>Nothing found in Île-de-France for “{q}”.</div>}
                    {state === 'error' && <div style={hint}>Address search is unavailable right now. Try again in a minute.</div>}
                    {places.map((p) => (
                        <button key={p.label} type="button" onClick={() => { onPick(p); setOpen(false); setQ(''); setPlaces([]); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none', background: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13.5, color: '#10151D' }}>
                            {p.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

const hint = { padding: '8px 10px', fontSize: 13, color: '#5F6876' };
