import React, { useState } from 'react';
import { Check, Loader2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MobileSheet from './MobileSheet.jsx';
import { startCheckout } from '../lib/checkout.js';
import {
    PLAN_LABELS, PLAN_PRICES, nextPlan, nextUsageReset, getProjectLimit, aiOpsMeter,
} from '../lib/planLimits.js';

/**
 * PlanSheet — the mobile plan-limit sheet (mockup "OutOfOps").
 *   reason 'ai_ops'   → out of AI operations (editor, from QUOTA_EXCEEDED)
 *   reason 'projects' → project limit reached (dashboard)
 *   reason 'plans'    → "See plans" from the dashboard usage meter
 * Shows the next plan's price and first features (same copy as the pricing
 * page), Upgrade (Polar checkout) and Not now. Mobile-only callers.
 */
export default function PlanSheet({ open, reason = 'ai_ops', plan = 'free', upgradeTo, used = null, onClose, onBilling }) {
    const { t, i18n } = useTranslation('common');
    const { t: tl } = useTranslation('landing');
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const target = upgradeTo || nextPlan(plan);
    const planLabel = PLAN_LABELS[plan] || PLAN_LABELS.free;
    const targetLabel = target ? (PLAN_LABELS[target] || target) : null;
    const resetDate = new Intl.DateTimeFormat(i18n.language || 'en', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(nextUsageReset());
    const meter = aiOpsMeter(used, plan);

    let title;
    let body;
    if (reason === 'projects') {
        title = t('planSheet.projectsTitle');
        body = t('planSheet.projectsBody', { plan: planLabel, count: getProjectLimit(plan) });
    } else if (reason === 'plans') {
        title = t('planSheet.plansTitle');
        body = meter.unlimited
            ? t('planSheet.plansBodyUnlimited', { plan: planLabel })
            : t('planSheet.plansBody', { plan: planLabel, date: resetDate });
    } else {
        title = t('planSheet.aiOpsTitle');
        body = t('planSheet.aiOpsBody', { date: resetDate });
    }

    const features = target ? tl(`pricing.plans.${target}.features`, { returnObjects: true }) : [];
    const featureList = Array.isArray(features) ? features.slice(0, 4) : [];

    const handleUpgrade = async () => {
        if (!target) return;
        setFailed(false);
        setLoading(true);
        const redirected = await startCheckout(target);
        if (!redirected) { setLoading(false); setFailed(true); }
    };

    return (
        <MobileSheet open={open} title={title} onClose={onClose}>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--fg-2)' }}>{body}</p>

            {reason === 'plans' && used !== null && !meter.unlimited && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(meter.ratio * 100)}%`, height: '100%', background: meter.exhausted ? 'var(--coral)' : 'var(--accent)' }} />
                    </div>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-2)' }}>{meter.used} / {meter.limit}</span>
                </div>
            )}

            {target && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 16, border: '1px solid color-mix(in oklch, var(--accent) 35%, transparent)', background: 'var(--accent-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
                            <Zap size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />
                            {targetLabel}
                        </span>
                        {PLAN_PRICES[target] && (
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--fg)' }}>
                                {t('planSheet.perMonth', { price: PLAN_PRICES[target] })}
                            </span>
                        )}
                    </div>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {featureList.map((f) => (
                            <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--fg-2)' }}>
                                <Check size={14} style={{ color: 'var(--mint)', flexShrink: 0 }} aria-hidden="true" />
                                {f}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {failed && (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--coral)' }}>{t('planSheet.checkoutFailed')}</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {target ? (
                    <button
                        type="button"
                        onClick={handleUpgrade}
                        disabled={loading}
                        style={{ minHeight: 50, borderRadius: 14, border: 0, background: 'var(--accent)', color: '#fff', fontSize: 16, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : t('planSheet.upgradeTo', { plan: targetLabel })}
                    </button>
                ) : onBilling && (
                    <button
                        type="button"
                        onClick={onBilling}
                        style={{ minHeight: 50, borderRadius: 14, border: 0, background: 'var(--accent)', color: '#fff', fontSize: 16, fontWeight: 600 }}
                    >
                        {t('planSheet.manageBilling')}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onClose}
                    style={{ minHeight: 46, borderRadius: 14, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg-2)', fontSize: 15 }}
                >
                    {t('planSheet.notNow')}
                </button>
            </div>
        </MobileSheet>
    );
}
