import React, { lazy, Suspense, useEffect } from 'react';
import { bindEditSteps } from './store/useEditStepsStore';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MARKET_ENABLED } from './lib/marketFlag';
import ConsentBanner from './components/ConsentBanner';
import { supabase } from './lib/supabaseClient';
import useSessionStore from './store/useSessionStore';

// Route-level loading keeps the editor, landing 3D scene, and account/legal
// screens out of the initial app bundle until the visitor opens them.
const HomePage = lazy(() => import('./pages/HomePage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AnalyzerPage = lazy(() => import('./pages/AnalyzerPage'));
// VIBED Market: the gate picks buyer / talent per account; the Trust desk is
// admin-only (R100). MarketplacePage is now loaded through the gate.
const MarketGate = lazy(() => import('./market/MarketGate').then((m) => ({ default: m.MarketGate })));
const MarketAdminGate = lazy(() => import('./market/MarketGate').then((m) => ({ default: m.MarketAdminGate })));
// Talent onboarding (R101): the public page the landing nav links to, then the guided setup.
const BecomeTalentPage = lazy(() => import('./market/talent/BecomeTalentPage'));
const TalentSetup = lazy(() => import('./market/talent/TalentSetup'));
const DesignStudioPage = lazy(() => import('./pages/DesignStudioPage'));
const DataPage = lazy(() => import('./pages/DataPage'));
const GdprPage = lazy(() => import('./pages/GdprPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const SuccessPage = lazy(() => import('./pages/SuccessPage'));
const CookiePolicyPage = lazy(() => import('./pages/CookiePolicyPage'));
const UserStylePage = lazy(() => import('./pages/UserStylePage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const LegalNoticePage = lazy(() => import('./pages/LegalNoticePage'));
const UnsubscribePage = lazy(() => import('./pages/UnsubscribePage'));

function App() {
    const { migrateSession } = useSessionStore();

    // One app-wide subscription that turns the engine's per-command events into
    // the step list the mobile progress screen reads.
    useEffect(() => bindEditSteps(), []);

    useEffect(() => {
        // When Supabase completes a sign-in (magic link, OAuth, email+password),
        // migrate any pending anonymous session to the authenticated user.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
                    const { isAnonymous: stillAnonymous } = useSessionStore.getState();
                    if (stillAnonymous) await migrateSession(session.user.id);
                }
            }
        );
        return () => subscription.unsubscribe();
    }, [migrateSession]);

    return (
        <BrowserRouter>
            <Suspense fallback={null}>
                <Routes>
                    <Route path="/"        element={<HomePage />} />
                    <Route path="/auth"    element={<AuthPage />} />

                    {/* Dashboard — authenticated users only (DashboardPage handles its own redirect) */}
                    <Route path="/dashboard" element={<DashboardPage />} />

                    {/* Editor — /editor for new/anonymous, /editor/:projectId to open a saved project */}
                    <Route path="/editor"            element={<EditorPage />} />
                    <Route path="/editor/:projectId" element={<EditorPage />} />

                    {/* Studio & Crew Marketplace — Pro & Business member network */}
                    {/* VIBED Market is hidden until it runs on real data (R102):
                        with the switch off, its paths send people home. */}
                    {['/marketplace', '/admin/trust', '/talent', '/talent/setup'].map((path) => (
                        <Route key={path} path={path} element={MARKET_ENABLED ? {
                            '/marketplace': <MarketGate />,
                            '/admin/trust': <MarketAdminGate />,
                            '/talent': <BecomeTalentPage />,
                            '/talent/setup': <TalentSetup />,
                        }[path] : <Navigate to="/" replace />} />
                    ))}

                    {/* Design Studio — Figma-class AI & manual workspace */}
                    <Route path="/design"            element={<DesignStudioPage />} />
                    <Route path="/analyzer"          element={<AnalyzerPage mode="design" />} />

                    {/* "Your Style" — what the Editorial Brain has learned about this
                    user, plus the GDPR reset/export controls for that data. The
                    page was fully built but had no <Route> for it, so none of it
                    was reachable (see CLAUDE.md R37). */}
                    <Route path="/style"    element={<UserStylePage />} />
                    <Route path="/account"  element={<AccountPage />} />

                    <Route path="/data"     element={<DataPage />} />
                    <Route path="/gdpr"     element={<GdprPage />} />
                    <Route path="/privacy"  element={<PrivacyPage />} />
                    <Route path="/success"       element={<SuccessPage />} />
                    <Route path="/cookie-policy" element={<CookiePolicyPage />} />
                    <Route path="/terms"         element={<TermsPage />} />
                    <Route path="/legal"         element={<LegalNoticePage />} />
                    <Route path="/unsubscribe"   element={<UnsubscribePage />} />
                </Routes>
            </Suspense>
            <ConsentBanner />
        </BrowserRouter>
    );
}

export default App;
