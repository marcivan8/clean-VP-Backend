/**
 * AuthPromptModal.jsx
 * Progressive auth: surfaces at value moments, never at access moments.
 *
 * Trigger messages:
 *   export       — "Create a free account to download your edit"
 *   ai_success   — "That worked. Create an account to save your project"
 *   timer        — "You've been editing for a while. Save your progress?"
 *   exit_intent  — "Don't lose your edit — save it with a free account"
 */

import React, { useState } from 'react';
import { X, Sparkles, Download, Save, Clock, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import useSessionStore from '../store/useSessionStore';

const TRIGGER_ICONS = {
    export:      Download,
    ai_success:  Sparkles,
    timer:       Clock,
    exit_intent: Save,
};

const TRIGGER_ACCENTS = {
    export:      'var(--accent)',
    ai_success:  'var(--accent)',
    timer:       'oklch(0.78 0.13 32)',
    exit_intent: 'var(--accent)',
};

const AuthPromptModal = ({ trigger = 'export', onDismiss, onSuccess }) => {
    const { t } = useTranslation('auth');
    const triggerKey = TRIGGER_ICONS[trigger] ? trigger : 'export';
    const Icon   = TRIGGER_ICONS[triggerKey];
    const config = {
        icon:    Icon,
        heading: t(`prompt.${triggerKey}.heading`),
        body:    t(`prompt.${triggerKey}.body`),
        cta:     t(`prompt.${triggerKey}.cta`),
        accent:  TRIGGER_ACCENTS[triggerKey],
    };

    const [mode,     setMode]     = useState('signup'); // 'signup' | 'signin'
    const [email,    setEmail]    = useState('');
    const [password, setPassword] = useState('');
    const [status,   setStatus]   = useState('idle'); // 'idle' | 'loading' | 'done' | 'error'
    const [errorMsg, setErrorMsg] = useState('');

    const { migrateSession } = useSessionStore();

    const submit = async (e) => {
        e.preventDefault();
        if (!email || !password) return;
        setStatus('loading');
        setErrorMsg('');

        try {
            let userId;

            if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: { emailRedirectTo: `${window.location.origin}/dashboard` },
                });
                if (error) throw error;
                userId = data.user?.id;
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
                userId = data.user?.id;
            }

            if (userId) await migrateSession(userId);
            setStatus('done');
            setTimeout(() => onSuccess?.(), 1200);
        } catch (err) {
            setStatus('error');
            setErrorMsg(err.message || 'Something went wrong. Try again.');
        }
    };

    return (
        // Backdrop
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) onDismiss?.(); }}
        >
            <div
                className="relative w-full max-w-sm rounded-2xl overflow-hidden"
                style={{ background: 'var(--bg-2)', border: '0.5px solid var(--line-strong)' }}
            >
                {/* Top accent bar */}
                <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${config.accent}, var(--violet))` }} />

                {/* Dismiss */}
                <button
                    onClick={onDismiss}
                    className="absolute top-3 right-3 p-1.5 rounded-lg transition-colors"
                    style={{ color: 'var(--fg-4)' }}
                    onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-4)'}
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="p-6">
                    {/* Icon + heading */}
                    <div className="flex items-start gap-3 mb-5">
                        <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center" style={{ background: `color-mix(in oklch, ${config.accent} 16%, transparent)`, border: `0.5px solid color-mix(in oklch, ${config.accent} 30%, transparent)` }}>
                            <Icon className="w-4 h-4" style={{ color: config.accent }} />
                        </div>
                        <div>
                            <h2 style={{ fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 700, color: 'var(--fg)', lineHeight: 1.3 }}>
                                {config.heading}
                            </h2>
                            <p className="mt-1" style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                                {config.body}
                            </p>
                        </div>
                    </div>

                    {status === 'done' ? (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.15)' }}>
                                <Check className="w-5 h-5 text-green-400" />
                            </div>
                            <p style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg-2)' }}>
                                {mode === 'signup' ? t('prompt.saved.signup') : t('prompt.saved.signin')}
                            </p>
                        </div>
                    ) : (
                        <form onSubmit={submit} className="flex flex-col gap-3">
                            <input
                                type="email"
                                placeholder={t('prompt.emailPlaceholder')}
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1"
                                style={{ background: 'rgba(0,0,0,0.4)', border: '0.5px solid var(--line)', color: 'var(--fg)', fontFamily: 'var(--f-sans)', '--tw-ring-color': config.accent }}
                            />
                            <input
                                type="password"
                                placeholder={t('prompt.passwordPlaceholder')}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                minLength={8}
                                required
                                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-1"
                                style={{ background: 'rgba(0,0,0,0.4)', border: '0.5px solid var(--line)', color: 'var(--fg)', fontFamily: 'var(--f-sans)', '--tw-ring-color': config.accent }}
                            />

                            {status === 'error' && (
                                <p style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'oklch(0.7 0.18 25)' }}>
                                    {errorMsg}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'loading'}
                                className="w-full rounded-lg py-2.5 flex items-center justify-center gap-2 text-sm font-semibold transition-all disabled:opacity-60"
                                style={{ background: `linear-gradient(135deg, ${config.accent}, var(--violet))`, color: '#fff', fontFamily: 'var(--f-sans)' }}
                            >
                                {status === 'loading'
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <><span>{config.cta}</span><ArrowRight className="w-3.5 h-3.5" /></>
                                }

                            </button>

                            {/* Mode toggle */}
                            <p className="text-center" style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-4)' }}>
                                {mode === 'signup' ? t('prompt.signinPrompt') + ' ' : t('prompt.signupPrompt') + ' '}
                                <button
                                    type="button"
                                    onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setErrorMsg(''); }}
                                    style={{ color: 'var(--fg-2)', textDecoration: 'underline' }}
                                >
                                    {mode === 'signup' ? t('prompt.signinLabel') : t('prompt.signupLabel')}
                                </button>
                            </p>
                        </form>
                    )}
                </div>

                {/* Subtle trust footer */}
                <div className="px-6 pb-4">
                    <p style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {t('prompt.trust')}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default AuthPromptModal;
