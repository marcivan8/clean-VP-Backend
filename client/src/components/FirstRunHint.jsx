/**
 * FirstRunHint.jsx
 *
 * R105 — the small, non-blocking half of onboarding.
 *
 * The walkthrough runs once, before the user has done anything, and teaches
 * the shape of the product. It cannot teach the thing that matters most,
 * which is what to do NEXT, because at that moment there is no next: there
 * is no footage, no timeline and no cut. These hints fill that gap. Each one
 * fires the first time a user reaches a particular state, points at the
 * control that acts on it, and goes away.
 *
 * ── WHY THEY LOOK THE WAY THEY DO ───────────────────────────────────────
 *
 * NO OVERLAY, NO SPOTLIGHT, NO BLOCKED CLICKS. A tour earns the right to
 * take over the screen because the user has just arrived and has nothing
 * else to do. A hint interrupts someone mid-edit, so it is a card beside a
 * control, never a wall in front of one. `pointer-events` stay on the card
 * alone; everything underneath keeps working, including the control the
 * hint is pointing at.
 *
 * ONE AT A TIME. Two popovers on screen is not guidance, it is noise, and
 * the second one usually covers the first. Hints queue, and the queue is
 * capped per session (MAX_PER_SESSION) so a user who does six new things in
 * five minutes is taught twice, not six times.
 *
 * THEY LEAVE ON THEIR OWN. A hint auto-dismisses after DISMISS_MS, and any
 * click on the thing it points at dismisses it immediately — acting on a
 * hint is the signal that it has done its job.
 *
 * SEEN IS SEEN. Dismissal is recorded per user via onboardingProgress, not
 * per browser, and recorded on SHOW rather than on dismiss: a hint that was
 * displayed has been spent, whether the user read it, ignored it, or closed
 * the tab.
 *
 * Anchors are `[data-hint="<anchor>"]` attributes on existing controls, so
 * this component never needs to know how those controls are built.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import EventBus from '../agent/EventBus.js';
import { hasSeen, isProgressReady, markSeen } from '../services/onboardingProgress.js';

export const HINT_EVENT = 'onboarding:hint';

/** How long a hint sits there before retiring itself. */
const DISMISS_MS = 11000;
/** Teaching budget for one session. Past this, the user is left alone. */
const MAX_PER_SESSION = 2;
/** A hint fired while the user is mid-action waits this long for them to land. */
const SETTLE_MS = 700;

/**
 * Every hint this app can show: which control it points at and which side it
 * sits on. The `key` doubles as the i18n key and the stored progress key, so
 * adding a hint is one entry here plus two strings per locale.
 *
 * `plan` marks a hint that teaches a paid feature. Those are shown to free
 * users too — deliberately — but the copy says what it costs, so the hint is
 * an honest offer rather than a dead end. See the `locked` strings.
 */
export const HINTS = Object.freeze({
    first_upload:   { anchor: 'assistant-input', placement: 'left'  },
    first_clip:     { anchor: 'timeline-strip',  placement: 'top'   },
    first_ai_edit:  { anchor: 'timeline-strip',  placement: 'top'   },
    first_captions: { anchor: 'tab-captions',    placement: 'right' },
    auto_available: { anchor: 'style-picker',    placement: 'top', plan: 'creator' },
    shorts_ready:   { anchor: 'tab-shorts',      placement: 'right', plan: 'creator' },
    before_export:  { anchor: 'export-button',   placement: 'bottom' },
});

/**
 * Ask for a hint. Cheap and safe to call from anywhere, including inside a
 * hot path: everything that would stop it showing is checked here, before
 * any state is touched.
 *
 * @param {keyof typeof HINTS} key
 */
export function triggerHint(key) {
    if (!HINTS[key]) return;
    // Progress not loaded yet means `hasSeen` answers true, so this is also
    // the guard against teaching someone during the first few hundred ms.
    if (!isProgressReady() || hasSeen(key)) return;
    EventBus.emit(HINT_EVENT, { key });
}

export default function FirstRunHint({ plan = 'free' }) {
    const { t } = useTranslation('editor');
    const [active, setActive] = useState(null);   // { key, anchor, placement, plan }
    const [rect, setRect] = useState(null);
    const queue = useRef([]);
    const shownCount = useRef(0);
    const timer = useRef(null);

    const dismiss = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        setActive(null);
        setRect(null);
        // Drain the queue on the next tick so two hints never cross-fade.
        setTimeout(() => {
            const next = queue.current.shift();
            if (next) EventBus.emit(HINT_EVENT, { key: next });
        }, 400);
    }, []);

    // ── Intake ──────────────────────────────────────────────────────────
    useEffect(() => {
        const onHint = ({ key }) => {
            const spec = HINTS[key];
            if (!spec || hasSeen(key)) return;
            if (shownCount.current >= MAX_PER_SESSION) return;
            // Busy: hold it rather than replacing what is on screen.
            if (active) {
                if (!queue.current.includes(key)) queue.current.push(key);
                return;
            }
            // Spent on show, not on dismiss — see the header.
            markSeen(key);
            shownCount.current += 1;
            setActive({ key, ...spec });
        };
        // EventBus.on returns its own unsubscribe function.
        return EventBus.on(HINT_EVENT, onHint);
    }, [active]);

    // ── Anchoring ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        let raf = 0;

        const measure = () => {
            if (cancelled) return;
            const el = document.querySelector(`[data-hint="${active.anchor}"]`);
            if (!el) { dismiss(); return; }   // control isn't on screen; say nothing
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) { dismiss(); return; }
            setRect(r);
        };

        // Wait for the action that triggered this to finish moving the layout.
        const settle = setTimeout(measure, SETTLE_MS);
        const track = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
        window.addEventListener('resize', track);
        window.addEventListener('scroll', track, true);

        timer.current = setTimeout(dismiss, SETTLE_MS + DISMISS_MS);

        // Acting on the hint dismisses it: the lesson landed.
        const el = document.querySelector(`[data-hint="${active.anchor}"]`);
        const onUse = () => dismiss();
        el?.addEventListener('click', onUse, { once: true });

        return () => {
            cancelled = true;
            clearTimeout(settle);
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', track);
            window.removeEventListener('scroll', track, true);
            el?.removeEventListener('click', onUse);
            if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        };
    }, [active, dismiss]);

    if (!active || !rect) return null;

    const W = 264;
    const GAP = 12;
    const clampX = x => Math.max(GAP, Math.min(x, window.innerWidth - W - GAP));
    const clampY = y => Math.max(GAP, Math.min(y, window.innerHeight - 130));

    const pos = { position: 'fixed', width: W, zIndex: 240 };
    if (active.placement === 'right')      { pos.left = clampX(rect.right + GAP); pos.top = clampY(rect.top); }
    else if (active.placement === 'left')  { pos.left = clampX(rect.left - W - GAP); pos.top = clampY(rect.top); }
    else if (active.placement === 'top')   { pos.left = clampX(rect.left + rect.width / 2 - W / 2); pos.top = clampY(rect.top - 118); }
    else                                   { pos.left = clampX(rect.left + rect.width / 2 - W / 2); pos.top = clampY(rect.bottom + GAP); }

    const locked = Boolean(active.plan) && plan === 'free';
    const body = locked
        ? t(`hints.${active.key}.locked`, { defaultValue: t(`hints.${active.key}.body`) })
        : t(`hints.${active.key}.body`);

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                ...pos,
                background: 'var(--bg-2)',
                border: '0.5px solid var(--line-strong)',
                borderRadius: 14,
                boxShadow: '0 18px 44px -14px rgba(0,0,0,0.66)',
                overflow: 'hidden',
                animation: 'vpHintIn 0.26s cubic-bezier(0.2,0.8,0.2,1)',
            }}
        >
            <style>{`
                @keyframes vpHintIn { from { opacity: 0; transform: translateY(5px) } to { opacity: 1; transform: none } }
                @media (prefers-reduced-motion: reduce) { @keyframes vpHintIn { from { opacity: 1 } to { opacity: 1 } } }
            `}</style>
            <div style={{ height: 2, background: locked ? 'var(--violet)' : 'var(--accent)' }} />
            <div style={{ padding: '12px 13px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 12.5, fontWeight: 700, color: 'var(--fg)' }}>
                        {t(`hints.${active.key}.title`)}
                    </span>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label={t('hints.dismiss', 'Dismiss')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: 2, lineHeight: 1 }}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
                <p style={{ margin: '5px 0 0', fontFamily: 'var(--f-sans)', fontSize: 12, lineHeight: 1.55, color: 'var(--fg-2)' }}>
                    {body}
                </p>
            </div>
        </div>
    );
}
