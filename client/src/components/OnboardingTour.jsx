/**
 * OnboardingTour.jsx
 *
 * A spotlight walkthrough shown once to a new user the first time they land
 * in the editor — desktop only. The mobile layout hides these same panels
 * behind bottom sheets (see IDELayout.jsx's `isMobile` branching), so the
 * fixed-position anchors this component relies on don't apply there;
 * IDELayout only mounts this when the initial viewport is desktop-width.
 *
 * ── R105: WHAT CHANGED, AND WHY ─────────────────────────────────────────
 *
 * The first version pointed at four panels and named them: media, chat,
 * timeline, export. It taught the user where things ARE. It never said what
 * the product does that another editor does not, because every step was
 * about furniture.
 *
 * The numbers argued against it. Three quarters of new users create a
 * project, so arriving and starting is not the problem. Roughly one in
 * fourteen ever signs in on a second day. People try it once, get a result
 * they could have got elsewhere, and leave. A tour that labels panels does
 * nothing about that.
 *
 * So the steps now walk the shortest path to a FINISHED video — import, say
 * what you want, let Auto run the whole playbook, take a short out of it,
 * export — and the one in the middle is deliberately the loudest, because
 * one instruction producing a cut, captions, motion design and sound is the
 * only step a competitor does not have.
 *
 * ── PLAN AWARENESS, HONESTLY ────────────────────────────────────────────
 *
 * Auto mode, editing styles and the Shorts tab are Creator and Pro only
 * (EditingStylePicker.jsx, and the `shorts` tab's gate in IDELayout). A free
 * user is still shown those steps, because hiding the reason to upgrade is
 * not a kindness, but the copy says plainly what they cost. A step that
 * needs a plan the user does not have is marked `Creator` in the card
 * rather than pretending to be available.
 *
 * Targets are `[data-tour="..."]` attributes on controls in IDELayout.jsx,
 * so this component never needs to know how those controls are built. A step
 * whose target is not mounted is skipped rather than stranding the user.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hasSeen, isProgressReady, markSeen } from '../services/onboardingProgress.js';

const STEPS = [
    { target: 'media-panel',   key: 'import',    placement: 'right' },
    { target: 'ai-assistant',  key: 'say',       placement: 'left' },
    { target: 'style-picker',  key: 'auto',      placement: 'top',    plan: 'creator' },
    { target: 'tab-shorts',    key: 'shorts',    placement: 'right',  plan: 'creator' },
    { target: 'export-button', key: 'export',    placement: 'bottom' },
];

/**
 * R105 — progress moved to `profiles.usage_data.onboarding`, per user rather
 * than per browser, so a returning user is not taught twice on a second
 * device. The key is versioned: changing the steps means `tour_v2`, and
 * someone who completed `tour_v1` is NOT shown the new one. Re-teaching an
 * existing user is exactly the interruption this module exists to avoid; a
 * new walkthrough is for new users; returning users can replay it from
 * editor settings.
 */
export const TOUR_KEY = 'tour_v2';

/** Whether the tour should be offered. Progress must be loaded first. */
export function shouldShowOnboardingTour() {
    if (!isProgressReady()) return false;
    return !hasSeen(TOUR_KEY) && !hasSeen('tour_v1');
}

export default function OnboardingTour({ onDone, plan = 'free' }) {
    const { t } = useTranslation('editor');
    const [stepIndex, setStepIndex] = useState(0);
    const [rect, setRect] = useState(null);

    const finish = useCallback(() => {
        markSeen(TOUR_KEY);
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
    const needsUpgrade = Boolean(step.plan) && plan === 'free';

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
                            <h3 style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 700, color: 'var(--fg)', margin: 0, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                {t(`onboardingTour.${step.key}.title`)}
                                {/* A step the user's plan cannot reach says so here
                                    rather than in the body, so the limit is read
                                    before the promise instead of after it. */}
                                {needsUpgrade && (
                                    <span style={{
                                        fontFamily: 'var(--f-mono)', fontSize: 9, letterSpacing: '0.08em',
                                        textTransform: 'uppercase', color: 'var(--violet)',
                                        border: '0.5px solid var(--violet)', borderRadius: 999, padding: '2px 6px',
                                    }}>
                                        {t('onboardingTour.creatorBadge')}
                                    </span>
                                )}
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
                            {needsUpgrade
                                ? t(`onboardingTour.${step.key}.locked`, { defaultValue: t(`onboardingTour.${step.key}.body`) })
                                : t(`onboardingTour.${step.key}.body`)}
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
