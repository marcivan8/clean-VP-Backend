/**
 * client/src/market/talent/TalentListings.jsx — a talent's real listings (R102).
 * Create, edit, publish and pause, against /api/market/listings/*.
 *
 * The address is picked from our own search (Photon, Île-de-France only); the
 * server re-resolves the chosen label and uses its own coordinates, so a pin
 * can never be placed somewhere other than the address shown.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createListing, fetchMyListings, pauseListing, publishListing, searchAddress, updateListing } from '../marketApi.js';
import { Btn, Card, CardHead, Eyebrow, PageHead, Pill, Row } from '../ui.jsx';
import { useToast } from '../useToast.jsx';

const CATEGORY_OPTIONS = [
    ['studio', 'Studio or location', 'A place you host. Its address is shown.'],
    ['operator', 'Camera operator', 'You, with or without kit. Shown within about 1 km.'],
    ['crew', 'Crew', 'A team. Shown within about 1 km.'],
    ['sound', 'Sound', 'Recording and mixing on set. Shown within about 1 km.'],
];
const STATUS_TONE = { live: 'green', draft: undefined, paused: 'amber' };
const EMPTY = { category: 'studio', title: '', description: '', priceHalfDay: '', priceFullDay: '', travelRadiusKm: '', features: '', addressLabel: '' };

export default function TalentListings() {
    const navigate = useNavigate();
    const { report, toastNode } = useToast();
    const [mine, setMine] = useState(null);
    const [error, setError] = useState(null);
    const [editing, setEditing] = useState(null); // null | 'new' | listing
    const [blockers, setBlockers] = useState([]);

    const load = () => fetchMyListings().then((r) => (r.ok ? setMine(r.listings) : setError(r.error)));
    useEffect(() => { load(); }, []);

    const publish = async (l) => {
        const r = await publishListing(l.id);
        if (!r.ok && r.blockers) setBlockers(r.blockers);
        report(r, `“${l.name}” is live. Buyers near it can find it now.`);
        if (r.ok) { setBlockers([]); load(); }
    };
    const pause = async (l) => { const r = await pauseListing(l.id); report(r, `“${l.name}” is paused. It no longer appears to buyers.`); if (r.ok) load(); };

    if (editing) {
        return <ListingForm initial={editing === 'new' ? null : editing} onDone={(saved) => { setEditing(null); if (saved) { report({ ok: true }, 'Saved.'); load(); } }} />;
    }

    return (
        <>
            {toastNode}
            <PageHead
                kicker="Supply side · Listings"
                kickerTone="purple"
                title="What buyers can book"
                lede="Each listing is one thing you offer: a place, or your work. A draft is only visible to you until you publish it."
                right={<Btn tone="purple" onClick={() => setEditing('new')}>New listing</Btn>}
            />
            {blockers.length > 0 && (
                <div className="mk-callout is-amber" style={{ marginBottom: 18 }}>
                    <b>Finish your setup to publish.</b> {blockers.join(' ')}{' '}
                    <button type="button" className="mk-back" style={{ display: 'inline', margin: 0, color: 'var(--mk-teal)' }} onClick={() => navigate('/talent/setup')}>Open setup</button>
                </div>
            )}
            {error && <Card tone="red"><Eyebrow tone="red">Could not load your listings</Eyebrow><p className="mk-lede">{error}</p></Card>}
            {!error && !mine && <p className="mk-muted" role="status">Loading your listings…</p>}
            {mine && mine.length === 0 && (
                <Card>
                    <p className="mk-h3" style={{ marginBottom: 6 }}>No listings yet</p>
                    <p className="mk-muted" style={{ margin: 0 }}>Start with what buyers book you for most often. You can add more later.</p>
                    <Btn tone="purple" style={{ marginTop: 16 }} onClick={() => setEditing('new')}>Create my first listing</Btn>
                </Card>
            )}
            <div className="mk-stack">
                {(mine || []).map((l) => (
                    <Card key={l.id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span className="mk-h3">{l.name}</span>
                                    <Pill tone={STATUS_TONE[l.status]}>{l.status}</Pill>
                                    <Pill>{l.kind}</Pill>
                                </div>
                                <p className="mk-muted" style={{ margin: '6px 0 0' }}>{l.exactAddress} · €{l.priceHalfDay} half-day{l.priceFullDay ? ` · €${l.priceFullDay} full day` : ''}</p>
                                {!l.exactLocation && <p className="mk-note" style={{ marginTop: 6 }}>Buyers see “{l.address}” and a point within about 1 km, never your exact address.</p>}
                            </div>
                            <div className="mk-btn-row">
                                <Btn size="small" onClick={() => setEditing(l)}>Edit</Btn>
                                {l.status === 'live'
                                    ? <Btn size="small" onClick={() => pause(l)}>Pause</Btn>
                                    : <Btn size="small" tone="primary" onClick={() => publish(l)}>Publish</Btn>}
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </>
    );
}

function ListingForm({ initial, onDone }) {
    const [f, setF] = useState(() => (initial ? {
        category: initial.category, title: initial.name, description: initial.description || '',
        priceHalfDay: String(initial.priceHalfDay ?? ''), priceFullDay: initial.priceFullDay ? String(initial.priceFullDay) : '',
        travelRadiusKm: initial.travelRadiusKm != null ? String(initial.travelRadiusKm) : '',
        features: (initial.features || []).join(', '), addressLabel: initial.exactAddress || '',
    } : EMPTY));
    const [addressQuery, setAddressQuery] = useState('');
    const [places, setPlaces] = useState([]);
    const [addrState, setAddrState] = useState('idle');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

    useEffect(() => {
        if (addressQuery.trim().length < 3) return undefined;
        const t = setTimeout(async () => {
            setAddrState('searching');
            const r = await searchAddress(addressQuery);
            if (!r.ok) { setPlaces([]); setAddrState('error'); return; }
            setPlaces(r.places || []);
            setAddrState((r.places || []).length ? 'idle' : 'empty');
        }, 350);
        return () => clearTimeout(t);
    }, [addressQuery]);

    const save = async () => {
        setSaving(true); setError(null);
        const body = {
            category: f.category, title: f.title, description: f.description,
            priceHalfDay: Number(f.priceHalfDay), priceFullDay: f.priceFullDay === '' ? null : Number(f.priceFullDay),
            travelRadiusKm: f.travelRadiusKm === '' ? null : Number(f.travelRadiusKm),
            features: f.features.split(',').map((x) => x.trim()).filter(Boolean),
        };
        if (!initial || f.addressLabel !== initial.exactAddress) body.addressLabel = f.addressLabel;
        const r = initial ? await updateListing(initial.id, body) : await createListing(body);
        setSaving(false);
        if (r.ok) onDone(r.listing);
        else setError(r.error);
    };

    const isPlace = f.category === 'studio';
    return (
        <>
            <PageHead kicker="Supply side · Listings" kickerTone="purple" title={initial ? 'Edit listing' : 'New listing'}
                back={<button type="button" className="mk-back" onClick={() => onDone(null)}>← My listings</button>} />
            <div className="mk-grid mk-aside">
                <Card>
                    <div className="mk-label" id="mk-cat"><Eyebrow as="span">What is it</Eyebrow></div>
                    <div className="mk-grid mk-cols-2" style={{ gap: 10 }} role="radiogroup" aria-labelledby="mk-cat">
                        {CATEGORY_OPTIONS.map(([id, label, hint]) => (
                            <button key={id} type="button" role="radio" aria-checked={f.category === id} onClick={() => setF((x) => ({ ...x, category: id }))}
                                className="mk-option" style={f.category === id ? { background: 'var(--mk-teal-soft)', borderColor: 'var(--mk-teal)' } : undefined}>
                                <span><span style={{ display: 'block' }}>{label}</span><span className="mk-option-hint">{hint}</span></span>
                            </button>
                        ))}
                    </div>

                    <label className="mk-label" htmlFor="mk-title"><Eyebrow as="span">Title</Eyebrow></label>
                    <input id="mk-title" className="mk-input" maxLength={90} value={f.title} onChange={set('title')} placeholder={isPlace ? 'Daylight loft with cyclorama' : 'Camera and sound for interviews'} />

                    <label className="mk-label" htmlFor="mk-desc"><Eyebrow as="span">Description</Eyebrow></label>
                    <textarea id="mk-desc" className="mk-textarea" maxLength={2000} value={f.description} onChange={set('description')}
                        placeholder={isPlace ? 'Size, light, power, access, what is included.' : 'What you shoot, your kit, the languages you work in.'} />

                    <div className="mk-grid mk-cols-2" style={{ gap: 14 }}>
                        <div>
                            <label className="mk-label" htmlFor="mk-half"><Eyebrow as="span">Half-day price (€)</Eyebrow></label>
                            <input id="mk-half" className="mk-input" inputMode="decimal" value={f.priceHalfDay} onChange={set('priceHalfDay')} />
                        </div>
                        <div>
                            <label className="mk-label" htmlFor="mk-full"><Eyebrow as="span">Full-day price (€, optional)</Eyebrow></label>
                            <input id="mk-full" className="mk-input" inputMode="decimal" value={f.priceFullDay} onChange={set('priceFullDay')} />
                        </div>
                    </div>
                    <p className="mk-note">The number is yours. The platform never sets it and never auto-adjusts it.</p>

                    <label className="mk-label" htmlFor="mk-addr"><Eyebrow as="span">{isPlace ? 'Address of the place' : 'Where you are based'}</Eyebrow></label>
                    {f.addressLabel && <p style={{ margin: '0 0 8px' }}><Pill tone="teal">{f.addressLabel}</Pill></p>}
                    <input id="mk-addr" className="mk-input" value={addressQuery} onChange={(e) => setAddressQuery(e.target.value)} placeholder="Search an address in Île-de-France" autoComplete="off" />
                    {addrState === 'searching' && <p className="mk-note">Searching…</p>}
                    {addrState === 'empty' && <p className="mk-note">Nothing found in Île-de-France. The market opens there first.</p>}
                    {addrState === 'error' && <p className="mk-note mk-red">Address search is unavailable right now. Try again in a minute.</p>}
                    {places.length > 0 && (
                        <div style={{ border: '1px solid var(--mk-line)', borderRadius: 12, marginTop: 8, overflow: 'hidden' }}>
                            {places.map((p) => (
                                <button key={p.label} type="button" onClick={() => { setF((x) => ({ ...x, addressLabel: p.label })); setPlaces([]); setAddressQuery(''); }}
                                    style={{ all: 'unset', boxSizing: 'border-box', display: 'block', width: '100%', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--mk-line-soft)' }}>
                                    {p.label}{!p.precise && <span className="mk-muted"> · street level</span>}
                                </button>
                            ))}
                        </div>
                    )}

                    {!isPlace && (
                        <>
                            <label className="mk-label" htmlFor="mk-radius"><Eyebrow as="span">How far you travel (km, optional)</Eyebrow></label>
                            <input id="mk-radius" className="mk-input" inputMode="numeric" value={f.travelRadiusKm} onChange={set('travelRadiusKm')} />
                        </>
                    )}

                    <label className="mk-label" htmlFor="mk-feat"><Eyebrow as="span">{isPlace ? 'Features (comma separated)' : 'Kit and skills (comma separated)'}</Eyebrow></label>
                    <input id="mk-feat" className="mk-input" value={f.features} onChange={set('features')} placeholder={isPlace ? 'cyclorama, daylight, drive-in, 32A power' : 'two cameras, lav + boom, FR/EN'} />

                    {error && <p className="mk-red" role="alert" style={{ marginTop: 16 }}>{error}</p>}
                    <div className="mk-btn-row" style={{ marginTop: 20 }}>
                        <Btn tone="primary" disabled={saving || !f.addressLabel} onClick={save}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Save as draft'}</Btn>
                        <Btn tone="quiet" onClick={() => onDone(null)}>Cancel</Btn>
                    </div>
                </Card>
                <Card>
                    <CardHead title="What buyers will see" />
                    <Row label="Title" value={f.title || '—'} />
                    <Row label="Half-day" value={f.priceHalfDay ? `€${f.priceHalfDay}` : '—'} />
                    <Row label="Location" value={!f.addressLabel ? '—' : isPlace ? f.addressLabel : `${f.addressLabel.split(', ').pop()} · about 1 km`} />
                    <p className="mk-note">A buyer service fee is added at checkout. Ratings and job counts appear once you have completed bookings: nothing is shown until then.</p>
                </Card>
            </div>
        </>
    );
}
