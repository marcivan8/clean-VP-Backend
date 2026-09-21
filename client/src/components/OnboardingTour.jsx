/**
 * OnboardingTour.jsx
 *
 * A short, four-step spotlight walkthrough shown once to a new user the
 * first time they land in the editor — desktop only. The mobile layout
 * hides these same panels behind bottom sheets (see IDELayout.jsx's
 * `isMobile` branching), so the fixed-position anchors this component
 * relies on don't apply there; IDELayout only mounts this when the initial
 * viewport is desktop-width.
 *
 * Targets are found by `[data-tour="..."]` attributes already placed on the
 * relevant panels in IDELayout.jsx, so this component never needs to know
 * their internal structure — just their ids:
 *   media-panel   — left sidebar (import/media library)
 *   ai-assistant  — right sidebar (chat/assistant panel)
 *   timeline      — the timeline strip
 *   export-button — the export button in the top bar
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STEPS = [
    { target: 'media-panel',   key: 'media',     placement: 'right' },
    { target: 'ai-assistant',  key: 'assistant', placement: 'left' },
    { target: 'timeline',      key: 'timeline',  placement: 'top' },
    { target: 'export-button', key: 'export',    placement: 'bottom' },
];

const STORAGE_KEY = 'vp_onboarding_tour_seen';

/** Whether the tour should be offered — false once it's been shown or skipped. */
export function shouldShowOnboardingTour() {
    try {
        return !window.localStorage.getItem(STORAGE_KEY);
    } catch (_) {
        // Private-browsing / blocked storage — don't nag every reload if we
        // can't remember it was seen; just skip the tour entirely.
        return false;
    }
}

export default function OnboardingTour({ onDone }) {
    const { t } = useTranslation('editor');
    const [stepIndex, setStepIndex] = useState(0);
    const [rect, setRect] = useState(null);

    const finish = useCallback(() => {
        try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
        onDone?.();
    }, [onDone]);

    // Re-measure the current target on every step change and on resize, so
    // the spotlight tracks the real element instead of a stale position.
    useEffect(() => {
        const step = STEPS[stepIndex];

        const measure = () => {
            const el = document.querySelector(`[data-tour="${step.target}"]`);
            if (!el) {
                // Target isn't mounted (panel collapsed, different mode,
                // etc.) — don't strand the user on a step that can never
                // render; skip straight to the next one instead.
                if (stepIndex < STEPS.length - 1) setStepIndex(i => i + 1);
                else finish();
                return;
            }
            setRect(el.getBoundingClientRect());
        };

        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [stepIndex, finish]);

    const next = () => {
        if (stepIndex >= STEPS.length - 1) { finish(); return; }
        setStepIndex(i => i + 1);
    };

    if (!rect) return null;

    const step = STEPS[stepIndex];
    const isLast = stepIndex >= STEPS.length - 1;

    // Tooltip position — a fixed offset from the spotlighted rect on
    // whichever side has room, clamped inside the viewport.
    const margin = 16;
    const cardWidth = 300;
    const tooltipStyle = { position: 'fixed', zIndex: 301, width: cardWidth };
    if (step.placement === 'right') {
        tooltipStyle.left = Math.min(rect.right + margin, window.innerWidth - cardWidth - margin);
        tooltipStyle.top = Math.max(margin, rect.top);
    } else if (step.placement === 'left') {
        tooltipStyle.left = Math.max(margin, rect.left - cardWidth - margin);
        tooltipStyle.top = Math.max(margin, rect.top);
    } else if (step.placement === 'top') {
        tooltipStyle.left = Math.max(margin, Math.min(rect.left, window.innerWidth - cardWidth - margin));
        tooltipStyle.top = Math.max(margin, rect.top - 150);
    } else {
        // bottom
        tooltipStyle.left = Math.max(margin, Math.min(rect.right - cardWidth, window.innerWidth - cardWidth - margin));
        tooltipStyle.top = Math.min(rect.bottom + margin, window.innerHeight - 170);
    }

    return (
        <div className="fixed inset-0" style={{ zIndex: 300, pointerEvents: 'none' }}>
            {/* Spotlight cutout — a box at the target's rect with a huge
                box-shadow that darkens everything else on the page. Cheaper
                and more robust across browsers than an SVG mask for a
                single rectangular cutout. */}
            <div
                style={{
                    position: 'fixed',
                    left: rect.left - 6,
                    top: rect.top - 6,
                    width: rect.width + 12,
                    height: rect.height + 12,
                    borderRadius: 12,
                    boxShadow: '0 0 0 9999px rgba(6,6,10,0.72)',
                    border: '1.5px solid var(--accent)',
                    transition: 'left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease',
                    pointerEvents: 'none',
                }}
            />

            {/* Tooltip card */}
            <div style={{ ...tooltipStyle, pointerEvents: 'auto' }}>
                <div
                    className="rounded-2xl overflow-hidden"
                    style={{ background: 'var(--bg-2)', border: '0.5px solid var(--line-strong)', boxShadow: '0 24px 60px -16px rgba(0,0,0,0.7)' }}
                >
                    <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), var(--violet))' }} />
                    <div className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                            <h3 style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 700, color: 'var(--fg)', margin: 0 }}>
                                {t(`onboardingTour.${step.key}.title`)}
                            </h3>
                            <button
                                onClick={finish}
                                style={{ color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 1 }}
                                aria-label={t('onboardingTour.skip')}
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <p style={{ fontFamily: 'var(--f-sans)', fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.6, margin: 0 }}>
                            {t(`onboardingTour.${step.key}.body`)}
                        </p>
                        <div className="flex items-center justify-between mt-4">
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)', letterSpacing: '0.06em' }}>
                                {t('onboardingTour.stepCount', { current: stepIndex + 1, total: STEPS.length })}
                            </span>
                            <button
                                onClick={next}
                                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                                style={{ background: 'linear-gradient(135deg, var(--accent), var(--violet))', color: '#fff', fontFamily: 'var(--f-sans)', border: 'none', cursor: 'pointer' }}
                            >
                                {isLast ? t('onboardingTour.done') : t('onboardingTour.next')}
                                <ArrowRight className="w-3 h-3" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
