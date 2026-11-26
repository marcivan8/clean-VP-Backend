/**
 * client/src/components/ProFeatureLock.jsx — what a plan below the required one
 * sees instead of a paid feature (R104). The server refuses the same requests
 * (middleware/usageGate.js requirePlan); this screen only explains why and
 * offers the upgrade, it is not the gate.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Sparkles } from 'lucide-react';
import { startCheckout } from '../lib/checkout.js';
import { planPrice, PLAN_LABELS } from '../lib/planLimits.js';
import UpgradeFeatureDetails from './UpgradeFeatureDetails.jsx';

export default function ProFeatureLock({ feature, required = 'pro', variant = 'page' }) {
    const { t, i18n } = useTranslation('common');
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const planName = PLAN_LABELS[required];
    const price = planPrice(required, i18n.language);

    const upgrade = async () => {
        setBusy(true); setFailed(false);
        const ok = await startCheckout(required);
        if (!ok) { setBusy(false); setFailed(true); }
    };

    const title = t(`planLock.${feature}.title`);
    const body = t(`planLock.${feature}.body`);
    const cta = t('planLock.cta', { plan: planName, price });

    if (variant === 'inline') {
        return (
            <div className="mt-2 p-2.5 rounded-lg border border-primary/30 bg-primary/10 text-[11px]">
                <div className="flex items-center gap-1.5 font-semibold text-foreground mb-1">
                    <Lock className="w-3 h-3 text-primary" /> {title}
                </div>
                <p className="text-muted-foreground mb-2 leading-relaxed">{body}</p>
                <div className="mb-2"><UpgradeFeatureDetails feature={feature} plan={required} compact showBody={false} /></div>
                <button type="button" onClick={upgrade} disabled={busy}
                    className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-60 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> {cta}
                </button>
                {failed && <p role="alert" className="mt-1.5 text-amber-400">{t('planLock.failed')}</p>}
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)' }}>
            <div style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: '32px 24px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.09)' }}>
                <div style={{ width: 44, height: 44, margin: '0 auto 16px', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklch, var(--accent) 14%, transparent)', border: '0.5px solid color-mix(in oklch, var(--accent) 28%, transparent)' }}>
                    <Lock size={20} color="var(--accent)" />
                </div>
                <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>{title}</h1>
                <p style={{ color: 'var(--fg-2)', fontSize: 14.5, lineHeight: 1.55, margin: '0 0 18px' }}>{body}</p>
                <div style={{ margin: '0 0 22px' }}><UpgradeFeatureDetails feature={feature} plan={required} showBody={false} /></div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button type="button" onClick={upgrade} disabled={busy}
                        style={{ background: 'linear-gradient(135deg, var(--accent), var(--violet))', color: '#fff', border: 'none', borderRadius: 999, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                        {cta}
                    </button>
                    <button type="button" onClick={() => navigate('/dashboard')}
                        style={{ background: 'transparent', color: 'var(--fg-2)', border: '0.5px solid var(--line-strong)', borderRadius: 999, padding: '10px 18px', fontSize: 14, cursor: 'pointer' }}>
                        {t('planLock.back')}
                    </button>
                </div>
                {failed && <p role="alert" style={{ color: 'var(--warning, #f5a524)', fontSize: 13, marginTop: 14 }}>{t('planLock.failed')}</p>}
            </div>
        </div>
    );
}
