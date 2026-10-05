import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Logo } from '../components/Logo.jsx';
import { legalValues } from './legalInfo';
import { openConsentSettings } from '../lib/consent';

// Renders a legal page from a locale namespace (privacy, terms, cookies...).
//
// Locale shape:
//   eyebrow, title, intro: string | string[], lastUpdated: "... {{date}}"
//   summary?: [{ title, body }]            short cards under the header
//   toc?: string                           heading of the contents list
//   sections: [{ id, title, blocks: Block[] }]
// Block:
//   "text"                                 paragraph
//   { list: string[] }                     bullet list
//   { table: { head: string[], rows: string[][] } }
//   { defs: [{ term, desc, requires? }] }  label / value rows
//   { note: "text" }                       highlighted paragraph
//   { faq: [{ q, a }] }                    collapsible questions
//   { action: "cookie-settings", label }   button that reopens the consent panel
// Inline: [label](href) links, **bold**. Values such as {{email}} come from
// legalInfo.js. A block or def with `requires: "phone"` is hidden while that
// value is empty.

const LINK_SOURCE = String.raw`\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*`;

function Inline({ text }) {
    const s = String(text ?? '');
    const out = [];
    let last = 0;
    const re = new RegExp(LINK_SOURCE, 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
        if (m.index > last) out.push(s.slice(last, m.index));
        if (m[3]) {
            out.push(<strong key={m.index} style={{ color: 'var(--fg)', fontWeight: 600 }}>{m[3]}</strong>);
        } else {
            const href = m[2];
            const style = { color: 'var(--accent)', textDecoration: 'none' };
            out.push(href.startsWith('/') && !href.includes('#')
                ? <Link key={m.index} to={href} style={style}>{m[1]}</Link>
                : <a key={m.index} href={href} style={style} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{m[1]}</a>);
        }
        last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return <>{out}</>;
}

function FaqItem({ q, a }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ borderBottom: '0.5px solid var(--line-soft)', padding: '14px 0' }}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                    color: 'var(--fg)', font: 'inherit', fontSize: 15, fontWeight: 600,
                }}
            >
                <span>{q}</span>
                {open ? <ChevronUp size={16} color="var(--fg-3)" /> : <ChevronDown size={16} color="var(--fg-3)" />}
            </button>
            {open && <p style={{ margin: '10px 0 0', fontSize: 14.5 }}><Inline text={a} /></p>}
        </div>
    );
}

function Block({ block, values, t }) {
    if (block == null) return null;
    if (typeof block === 'string') return <p style={{ margin: 0 }}><Inline text={block} /></p>;
    if (block.requires && !values[block.requires]) return null;

    if (block.list) {
        return (
            <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {block.list.map((item, i) => <li key={i}><Inline text={item} /></li>)}
            </ul>
        );
    }
    if (block.note) {
        return (
            <p style={{
                margin: 0, padding: '14px 16px', borderRadius: 8,
                background: 'var(--bg-2)', border: '0.5px solid var(--line)', fontSize: 14.5,
            }}>
                <Inline text={block.note} />
            </p>
        );
    }
    if (block.defs) {
        return (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) 1fr', rowGap: 10, columnGap: 16 }}>
                {block.defs.filter(d => !d.requires || values[d.requires]).map((d, i) => (
                    <React.Fragment key={i}>
                        <dt style={{ color: 'var(--fg-3)', fontSize: 14 }}>{d.term}</dt>
                        <dd style={{ margin: 0 }}><Inline text={d.desc} /></dd>
                    </React.Fragment>
                ))}
            </dl>
        );
    }
    if (block.table) {
        const { head = [], rows = [] } = block.table;
        return (
            <div style={{ overflowX: 'auto', border: '0.5px solid var(--line)', borderRadius: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, lineHeight: 1.55, minWidth: head.length > 3 ? 620 : 0 }}>
                    <thead>
                        <tr>
                            {head.map((h, i) => (
                                <th key={i} scope="col" style={{
                                    textAlign: 'left', padding: '10px 12px', background: 'var(--bg-2)',
                                    color: 'var(--fg)', fontWeight: 600, borderBottom: '0.5px solid var(--line)',
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, r) => (
                            <tr key={r}>
                                {row.map((cell, c) => (
                                    <td key={c} style={{
                                        padding: '10px 12px', verticalAlign: 'top',
                                        borderTop: r === 0 ? 'none' : '0.5px solid var(--line-soft)',
                                        color: c === 0 ? 'var(--fg)' : 'var(--fg-2)',
                                    }}><Inline text={cell} /></td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    if (block.faq) {
        return <div>{block.faq.map((f, i) => <FaqItem key={i} q={f.q} a={f.a} />)}</div>;
    }
    if (block.action === 'cookie-settings') {
        return (
            <div>
                <button
                    type="button"
                    onClick={openConsentSettings}
                    style={{
                        minHeight: 40, padding: '0 16px', borderRadius: 8, cursor: 'pointer',
                        border: '0.5px solid var(--line-strong)', background: 'var(--bg-2)',
                        color: 'var(--fg)', font: 'inherit', fontSize: 14, fontWeight: 500,
                    }}
                >
                    {block.label || t('common:footer.links.cookieSettings')}
                </button>
            </div>
        );
    }
    return null;
}

export default function LegalDocument({ ns }) {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation([ns, 'common']);
    const values = legalValues(i18n.resolvedLanguage || i18n.language);
    const get = (key) => t(key, { ...values, returnObjects: true, defaultValue: null });

    const intro = get('intro');
    const summary = get('summary');
    const sections = get('sections');
    const toc = t('toc', { defaultValue: '' });
    const list = Array.isArray(sections) ? sections : [];

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>
            <nav style={{
                position: 'sticky', top: 0, zIndex: 40,
                borderBottom: '0.5px solid var(--line-soft)',
                background: 'var(--glass)', backdropFilter: 'blur(20px) saturate(160%)',
                WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            }}>
                <div style={{
                    maxWidth: 760, margin: '0 auto', padding: '0 16px',
                    height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8, font: 'inherit',
                            fontSize: 13, color: 'var(--fg-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        }}
                    >
                        <ArrowLeft size={14} /> {t('common:nav.backToVibed')}
                    </button>
                    <Logo size={22} />
                </div>
            </nav>

            <main style={{ maxWidth: 760, margin: '0 auto', padding: '56px 16px 96px' }}>
                <header style={{ marginBottom: 40 }}>
                    <div className="mono" style={{
                        fontSize: 10.5, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14,
                    }}>{t('eyebrow')}</div>
                    <h1 style={{
                        fontSize: 'clamp(30px, 5vw, 44px)', fontWeight: 700, lineHeight: 1.15,
                        letterSpacing: '-0.02em', color: 'var(--fg)', margin: '0 0 12px',
                    }}>{t('title')}</h1>
                    <p style={{ color: 'var(--fg-4)', fontSize: 13.5, margin: '0 0 24px' }}>
                        {t('lastUpdated', values)}
                    </p>
                    {(Array.isArray(intro) ? intro : intro ? [intro] : []).map((p, i) => (
                        <p key={i} style={{ fontSize: 16, color: 'var(--fg-2)', lineHeight: 1.75, margin: '0 0 12px' }}>
                            <Inline text={p} />
                        </p>
                    ))}
                </header>

                {Array.isArray(summary) && summary.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginBottom: 48 }}>
                        {summary.map((card, i) => (
                            <div key={i} style={{ padding: 18, borderRadius: 10, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)' }}>
                                <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14.5, marginBottom: 6 }}>{card.title}</div>
                                <div style={{ fontSize: 13.5, color: 'var(--fg-3)', lineHeight: 1.6 }}><Inline text={card.body} /></div>
                            </div>
                        ))}
                    </div>
                )}

                {toc && list.length > 3 && (
                    <nav aria-label={toc} style={{ marginBottom: 48, paddingBottom: 32, borderBottom: '0.5px solid var(--line-soft)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14, marginBottom: 10 }}>{toc}</div>
                        <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                            {list.map(s => (
                                <li key={s.id}><a href={`#${s.id}`} style={{ color: 'var(--fg-2)', textDecoration: 'none' }}>{s.title}</a></li>
                            ))}
                        </ol>
                    </nav>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40, fontSize: 15, lineHeight: 1.75, color: 'var(--fg-2)' }}>
                    {list.map(s => (
                        <section key={s.id} id={s.id} style={{ scrollMarginTop: 72, padding: 0 }}>
                            <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 19, lineHeight: 1.35, margin: '0 0 14px' }}>{s.title}</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {(s.blocks || []).map((b, i) => <Block key={i} block={b} values={values} t={t} />)}
                            </div>
                        </section>
                    ))}
                </div>
            </main>
        </div>
    );
}
