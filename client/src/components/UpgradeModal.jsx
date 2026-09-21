/**
 * UpgradeModal.jsx
 *
 * Generic "you hit a plan limit" upgrade CTA, fired by EventBus's
 * QUOTA_EXCEEDED event (AI-ops cap today; any future plan-gated block can
 * reuse the same channel). Before this existed, hitting the AI-ops cap
 * inside the editor just logged a plain-text error with no button and no
 * path to checkout — see MediaExecutionEngine.js / TranscriptionManager.js's
 * QUOTA_EXCEEDED emits for where this is triggered from.
 *
 * Routes straight into the same /api/checkout/create flow the pricing page
 * (HomePage.jsx) and the dashboard's project-limit modal already use.
 */

import React, { useState } from 'react';
import { X, Zap, ArrowRight, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';

async function startCheckout(plan) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { window.location.href = '/auth'; return; }
        const res = await fetch('/api/checkout/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ plan }),
        });
        if (!res.ok) {
            console.error('[UpgradeModal] checkout failed:', await res.text());
            return;
        }
        const { url } = await res.json();
        window.location.href = url;
    } catch (err) {
        console.error('[UpgradeModal] checkout error:', err.message);
    }
}

const UpgradeModal = ({ message, upgradeRequired = 'creator', onClose }) => {
    const { t } = useTranslation('editor');
    const [loading, setLoading] = useState(false);
    const nextPlanLabel = upgradeRequired === 'pro' ? 'Pro' : 'Creator';

    const handleUpgrade = async () => {
        setLoading(true);
        await startCheckout(upgradeRequired);
        // No setLoading(false) on success — window.location.href navigation
        // is about to replace this page; leaving the spinner on avoids a
        // flash back to the idle button during that navigation.
        setLoading(false);
    };

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        >
            <div
                className="relative w-full max-w-sm rounded-2xl overflow-hidden"
                style={{ background: 'var(--bg-2)', border: '0.5px solid var(--line-strong)' }}
            >
                {/* Top accent bar — same treatment as AuthPromptModal */}
                <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), var(--violet))' }} />

                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--fg-4)' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-4)'}
                    aria-label={t('quotaModal.dismiss')}
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="p-6">
                    <div className="flex items-start gap-3 mb-5">
                        <div
                            className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center"
                            style={{
                                background: 'color-mix(in oklch, var(--accent) 16%, transparent)',
                                border: '0.5px solid color-mix(in oklch, var(--accent) 30%, transparent)',
                            }}
                        >
                            <Zap className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                        </div>
                        <div>
                            <h2 style={{ fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 700, color: 'var(--fg)', lineHeight: 1.3 }}>
                                {t('quotaModal.heading')}
                            </h2>
                            <p className="mt-1" style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                                {message || t('quotaModal.bodyFallback')}
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <button
                            onClick={handleUpgrade}
                            disabled={loading}
                            className="w-full rounded-lg py-2.5 flex items-center justify-center gap-2 text-sm font-semibold transition-all disabled:opacity-60"
                            style={{ background: 'linear-gradient(135deg, var(--accent), var(--violet))', color: '#fff', fontFamily: 'var(--f-sans)' }}
                        >
                            {loading
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <><span>{t('quotaModal.cta', { plan: nextPlanLabel })}</span><ArrowRight className="w-3.5 h-3.5" /></>
                            }
                        </button>
                        <button
                            onClick={onClose}
                            className="w-full rounded-lg py-2 text-center text-sm transition-colors"
                            style={{ color: 'var(--fg-4)', fontFamily: 'var(--f-sans)' }}
                        >
                            {t('quotaModal.dismiss')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default UpgradeModal;
