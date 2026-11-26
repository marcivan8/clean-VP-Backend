/**
 * client/src/components/UpgradeFeatureDetails.jsx — the "what this gives you,
 * and what you keep without it" block of every upgrade prompt (R172).
 *
 * Shared by PlanSheet (mobile), UpgradeModal (desktop) and ProFeatureLock, so
 * a refusal explains the feature the user actually tried to use instead of a
 * generic plan list. Copy: common.json `upgradeFeatures.<feature>`; the plan's
 * other lines come from the pricing page (landing.json), minus the ones the
 * feature section already covers.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus } from 'lucide-react';
import { PLAN_LABELS } from '../lib/planLimits.js';
import { isUpgradeFeature, otherPlanFeatures } from '../lib/upgradeFeatures.js';

export default function UpgradeFeatureDetails({ feature, plan, compact = false, showBody = true }) {
    const { t } = useTranslation('common');
    const { t: tl } = useTranslation('landing');
    if (!isUpgradeFeature(feature)) return null;

    const key = `upgradeFeatures.${feature}`;
    const gains = t(`${key}.gains`, { returnObjects: true });
    const overlap = t(`${key}.overlap`, { returnObjects: true });
    const planLabel = PLAN_LABELS[plan] || plan;
    const planFeatures = plan ? tl(`pricing.plans.${plan}.features`, { returnObjects: true }) : [];
    const others = otherPlanFeatures(planFeatures, overlap, compact ? 2 : 3);
    const size = compact ? 12.5 : 13.5;
    const label = { fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-3)', margin: '0 0 6px' };
    const item = { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: size, lineHeight: 1.45, color: 'var(--fg-2)' };
    const list = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 };

    return (
        <div data-upgrade-feature={feature} style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, textAlign: 'left' }}>
            {showBody && <p style={{ margin: 0, fontSize: compact ? 13 : 14, lineHeight: 1.5, color: 'var(--fg-2)' }}>{t(`${key}.body`)}</p>}

            {Array.isArray(gains) && gains.length > 0 && (
                <div>
                    <p style={label}>{t('upgradeFeatures.youGet', { plan: planLabel })}</p>
                    <ul style={list}>
                        {gains.map(g => (
                            <li key={g} style={item}>
                                <Check size={14} style={{ color: 'var(--mint, #34d399)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                                <span>{g}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div>
                <p style={label}>{t('upgradeFeatures.without')}</p>
                <p style={{ ...item, margin: 0 }}>
                    <Minus size={14} style={{ color: 'var(--fg-4)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                    <span>{t(`${key}.without`)}</span>
                </p>
            </div>

            {others.length > 0 && (
                <div>
                    <p style={label}>{t('upgradeFeatures.alsoIn', { plan: planLabel })}</p>
                    <ul style={list}>
                        {others.map(o => (
                            <li key={o} style={{ ...item, color: 'var(--fg-3)' }}>
                                <Check size={14} style={{ color: 'var(--fg-4)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                                <span>{o}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
