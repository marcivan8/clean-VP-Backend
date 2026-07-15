import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabaseClient';
import useSessionStore from '../store/useSessionStore';

const Logo = ({ size = 26 }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z" fill="none" stroke="currentColor" strokeWidth="32" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
    </svg>
);

const Spinner = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 0.75s linear infinite' }}>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
);

export default function AuthPage() {
    const navigate = useNavigate();
    const { t } = useTranslation('auth');
    const { migrateSession, clearSession } = useSessionStore();

    const [tab, setTab]           = useState('signin'); // 'signin' | 'signup'
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState(null);
    const [success, setSuccess]   = useState(null);
    const [currentUser, setCurrentUser] = useState(undefined); // undefined = loading
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);

    // Check current session on mount
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setCurrentUser(session?.user ?? null);
        });
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
            setCurrentUser(session?.user ?? null);
        });
        return () => subscription.unsubscribe();
    }, []);

    const sanitizeEmail = (raw) => raw.trim().toLowerCase().slice(0, 254);

    const handleSignIn = async (e) => {
        e.preventDefault();
        setError(null);
        const cleanEmail = sanitizeEmail(email);
        if (!cleanEmail || !password) {
            setError(t('error.emailRequired'));
            return;
        }
        setLoading(true);
        try {
            const { data, error: signInErr } = await supabase.auth.signInWithPassword({
                email: cleanEmail,
                password,
            });
            if (signInErr) throw signInErr;
            await migrateSession(data.user.id);
            navigate('/dashboard');
        } catch (err) {
            if (err.message?.toLowerCase().includes('invalid login credentials')) {
                setError(t('error.invalidCredentials'));
            } else if (err.message?.toLowerCase().includes('rate limit') || err.status === 429) {
                setError(t('error.rateLimit'));
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSignUp = async (e) => {
        e.preventDefault();
        setError(null);
        const cleanEmail = sanitizeEmail(email);
        if (!cleanEmail) {
            setError(t('error.emailInvalid'));
            return;
        }
        if (password.length < 6) {
            setError(t('error.passwordTooShort'));
            return;
        }
        setLoading(true);
        try {
            const { data, error: signUpErr } = await supabase.auth.signUp({
                email: cleanEmail,
                password,
                options: {
                    // After clicking the confirmation email, redirect to the dashboard.
                    // Must be listed in Supabase → Auth → URL Configuration → Redirect URLs:
                    //   https://vibedstudio.com/dashboard
                    //   http://localhost:5173/dashboard
                    emailRedirectTo: `${window.location.origin}/dashboard`,
                },
            });
            if (signUpErr) throw signUpErr;

            if (data.user && !data.user.identities?.length) {
                throw new Error(t('error.emailExists'));
            }

            // Create profile in our DB
            if (data.session) {
                await fetch('/api/auth/profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${data.session.access_token}`,
                    },
                    body: JSON.stringify({ email: cleanEmail }),
                });
                await migrateSession(data.user.id);
                navigate('/dashboard');
            } else {
                setSuccess(t('success.checkEmail'));
            }
        } catch (err) {
            if (err.message?.toLowerCase().includes('rate limit') || err.status === 429) {
                setError(t('error.rateLimit'));
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSignOut = async () => {
        setLoading(true);
        await supabase.auth.signOut();
        clearSession();
        setLoading(false);
    };

    const handleDeleteAccount = async () => {
        setDeleteLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch('/api/auth/account', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                },
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || t('error.deleteError'));
            }
            await supabase.auth.signOut();
            clearSession();
            navigate('/');
        } catch (err) {
            setError(err.message);
            setShowDeleteConfirm(false);
        } finally {
            setDeleteLoading(false);
        }
    };

    // ── Logged-in view ────────────────────────────────────────────────────────
    if (currentUser) {
        return (
            <Page t={t}>
                <Card>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center' }}>
                        <Avatar email={currentUser.email} />
                        <div>
                            <p style={{ margin: 0, fontWeight: 500, fontSize: 16, color: 'var(--fg)' }}>
                                {currentUser.email}
                            </p>
                        </div>
                        <StatusBadge registered={!!currentUser.email_confirmed_at} t={t} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                            <button
                                className="btn btn-primary"
                                style={{ width: '100%', justifyContent: 'center', borderRadius: 12 }}
                                onClick={() => navigate('/dashboard')}
                            >
                                {t('button.myProjects')}
                            </button>
                            <button
                                className="btn btn-ghost"
                                style={{ width: '100%', justifyContent: 'center', borderRadius: 12 }}
                                onClick={handleSignOut}
                                disabled={loading}
                            >
                                {loading ? <Spinner /> : t('button.signout')}
                            </button>
                        </div>

                        {/* Danger zone */}
                        <div style={{
                            width: '100%', borderTop: '0.5px solid var(--glass-stroke)',
                            paddingTop: 20, marginTop: 4,
                        }}>
                            {!showDeleteConfirm ? (
                                <button
                                    onClick={() => setShowDeleteConfirm(true)}
                                    style={{
                                        width: '100%', background: 'none', border: 'none',
                                        cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                                        color: 'var(--fg-4)', padding: '6px 0',
                                        transition: 'color 0.15s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = 'var(--coral)'}
                                    onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-4)'}
                                >
                                    {t('button.deleteAccount')}
                                </button>
                            ) : (
                                <div style={{
                                    padding: '14px 16px', borderRadius: 12,
                                    background: 'color-mix(in oklch, var(--coral) 10%, transparent)',
                                    border: '0.5px solid color-mix(in oklch, var(--coral) 28%, transparent)',
                                    display: 'flex', flexDirection: 'column', gap: 12,
                                }}>
                                    <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5 }}
                                       dangerouslySetInnerHTML={{ __html: t('delete.confirm') }}
                                    />
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            onClick={handleDeleteAccount}
                                            disabled={deleteLoading}
                                            style={{
                                                flex: 1, height: 36, borderRadius: 8, border: 'none',
                                                cursor: deleteLoading ? 'not-allowed' : 'pointer',
                                                background: 'var(--coral)', color: '#fff',
                                                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                opacity: deleteLoading ? 0.7 : 1,
                                            }}
                                        >
                                            {deleteLoading ? <Spinner /> : t('delete.confirmButton')}
                                        </button>
                                        <button
                                            onClick={() => setShowDeleteConfirm(false)}
                                            disabled={deleteLoading}
                                            style={{
                                                flex: 1, height: 36, borderRadius: 8,
                                                border: '0.5px solid var(--glass-stroke)',
                                                cursor: 'pointer', background: 'var(--bg-3)',
                                                color: 'var(--fg-2)', fontSize: 13,
                                                fontFamily: 'inherit',
                                            }}
                                        >
                                            {t('delete.cancel')}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </Card>
            </Page>
        );
    }

    // ── Loading ───────────────────────────────────────────────────────────────
    if (currentUser === undefined) {
        return (
            <Page t={t}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                    <Spinner />
                </div>
            </Page>
        );
    }

    // ── Auth form ─────────────────────────────────────────────────────────────
    return (
        <Page t={t}>
            <Card>
                {/* Logo + title */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 28 }}>
                    <Logo size={32} />
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                        {tab === 'signin' ? t('heading.signin') : t('heading.signup')}
                    </h1>
                    <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg-3)' }}>
                        {tab === 'signin' ? t('sub.signin') : t('sub.signup')}
                    </p>
                </div>

                {/* Tabs */}
                <TabBar tab={tab} setTab={(v) => { setTab(v); setError(null); setSuccess(null); }} t={t} />

                {/* Success message */}
                {success && (
                    <div style={{
                        marginTop: 16, padding: '10px 14px', borderRadius: 10,
                        background: 'color-mix(in oklch, var(--mint) 14%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--mint) 30%, transparent)',
                        fontSize: 13.5, color: 'var(--fg-2)',
                    }}>
                        {success}
                    </div>
                )}

                {/* Error message */}
                {error && (
                    <div style={{
                        marginTop: 16, padding: '10px 14px', borderRadius: 10,
                        background: 'color-mix(in oklch, var(--coral) 12%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--coral) 28%, transparent)',
                        fontSize: 13.5, color: 'var(--fg-2)',
                    }}>
                        {error}
                    </div>
                )}

                {/* Form */}
                <form onSubmit={tab === 'signin' ? handleSignIn : handleSignUp} style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Field label={t('field.email')} id="email">
                        <input
                            id="email"
                            type="email"
                            placeholder={t('field.emailPlaceholder')}
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            maxLength={254}
                            autoComplete="email"
                            spellCheck={false}
                            style={inputStyle}
                        />
                    </Field>
                    <Field label={t('field.password')} id="password">
                        <input
                            id="password"
                            type="password"
                            placeholder={tab === 'signup' ? t('field.passwordPlaceholderSignup') : t('field.passwordPlaceholderSignin')}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            maxLength={128}
                            minLength={tab === 'signup' ? 6 : undefined}
                            autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
                            style={inputStyle}
                        />
                    </Field>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', justifyContent: 'center', borderRadius: 12, marginTop: 4, height: 44 }}
                        disabled={loading}
                    >
                        {loading
                            ? <Spinner />
                            : tab === 'signin' ? t('button.signin') : t('button.signup')}
                    </button>
                </form>

                {/* AI Transparency Notice */}
                <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 12, color: 'var(--fg-4)', lineHeight: 1.4, padding: '0 10px' }}>
                    {t('aiNotice')}
                </p>

                {/* Footer link */}
                <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 13, color: 'var(--fg-3)' }}>
                    {tab === 'signin'
                        ? <>{t('footer.noAccount')}{' '}
                            <button onClick={() => { setTab('signup'); setError(null); }} style={linkBtn}>{t('footer.register')}</button>
                          </>
                        : <>{t('footer.alreadyAccount')}{' '}
                            <button onClick={() => { setTab('signin'); setError(null); }} style={linkBtn}>{t('footer.login')}</button>
                          </>
                    }
                </p>
            </Card>
        </Page>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Page({ children, t }) {
    return (
        <div style={{
            minHeight: '100vh', background: 'var(--bg)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '24px 16px',
        }}>
            <button
                onClick={() => window.history.back()}
                style={{
                    position: 'fixed', top: 20, left: 24,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--fg-3)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 8,
                    transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
            >
                {t('back')}
            </button>
            {children}
        </div>
    );
}

function Card({ children }) {
    return (
        <div style={{
            width: '100%', maxWidth: 400,
            background: 'var(--bg-2)',
            border: '0.5px solid var(--glass-stroke)',
            borderRadius: 20,
            padding: '32px 28px',
            boxShadow: 'var(--shadow-card)',
        }}>
            {children}
        </div>
    );
}

function TabBar({ tab, setTab, t }) {
    return (
        <div style={{
            display: 'flex', gap: 4,
            background: 'var(--glass)', border: '0.5px solid var(--glass-stroke)',
            borderRadius: 10, padding: 4,
        }}>
            {[['signin', t('tab.signin')], ['signup', t('tab.signup')]].map(([key, label]) => (
                <button
                    key={key}
                    onClick={() => setTab(key)}
                    style={{
                        flex: 1, height: 34, border: 'none', cursor: 'pointer',
                        borderRadius: 7, fontSize: 13.5, fontWeight: 500,
                        transition: 'all 0.18s ease',
                        background: tab === key ? 'var(--bg-3)' : 'transparent',
                        color: tab === key ? 'var(--fg)' : 'var(--fg-3)',
                        boxShadow: tab === key ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    }}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function Field({ label, id, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)' }}>
                {label}
            </label>
            {children}
        </div>
    );
}

function Avatar({ email }) {
    const initials = email ? email[0].toUpperCase() : '?';
    return (
        <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--accent-soft)',
            border: '1.5px solid color-mix(in oklch, var(--accent) 35%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 600, color: 'var(--accent)',
        }}>
            {initials}
        </div>
    );
}

function StatusBadge({ registered, t }) {
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500,
            background: registered
                ? 'color-mix(in oklch, var(--mint) 14%, transparent)'
                : 'color-mix(in oklch, var(--coral) 12%, transparent)',
            border: `0.5px solid ${registered
                ? 'color-mix(in oklch, var(--mint) 30%, transparent)'
                : 'color-mix(in oklch, var(--coral) 28%, transparent)'}`,
            color: registered ? 'var(--mint)' : 'var(--coral)',
        }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
            {registered ? t('status.verified') : t('status.unverified')}
        </div>
    );
}

const inputStyle = {
    width: '100%', height: 42, padding: '0 14px',
    background: 'var(--bg-3)', border: '0.5px solid var(--glass-stroke)',
    borderRadius: 10, color: 'var(--fg)', fontSize: 14,
    outline: 'none', fontFamily: 'inherit',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box',
};

const linkBtn = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--accent)', fontSize: 'inherit', fontFamily: 'inherit',
    padding: 0, textDecoration: 'underline', textUnderlineOffset: 2,
};
