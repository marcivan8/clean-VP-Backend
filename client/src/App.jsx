import React, { lazy, Suspense, useEffect } from 'react';
import { bindEditSteps } from './store/useEditStepsStore';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ConsentBanner from './components/ConsentBanner';
import { supabase } from './lib/supabaseClient';
import useSessionStore from './store/useSessionStore';

// Route-level loading keeps the editor, landing 3D scene, and account/legal
// screens out of the initial app bundle until the visitor opens them.
const HomePage = lazy(() => import('./pages/HomePage'));
const EditorPage = lazy(() => import('./pages/EditorPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AnalyzerPage = lazy(() => import('./pages/AnalyzerPage'));
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

                    <Route path="/analyzer" element={<AnalyzerPage />} />

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
