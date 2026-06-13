import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import AnalyzerPage from './pages/AnalyzerPage';
import DataPage from './pages/DataPage';
import GdprPage from './pages/GdprPage';
import AuthPage from './pages/AuthPage';
import PrivacyPage from './pages/PrivacyPage';
import AboutPage from './pages/AboutPage';
import SuccessPage from './pages/SuccessPage';
import { supabase } from './lib/supabaseClient';
import useSessionStore from './store/useSessionStore';

function App() {
    const { migrateSession } = useSessionStore();

    useEffect(() => {
        // When Supabase completes a sign-in (magic link, OAuth, email+password),
        // migrate any pending anonymous session to the authenticated user.
        // Read isAnonymous from the store directly (not the closure) to avoid
        // stale-closure bugs when the effect re-subscribes after migration.
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
            <Routes>
                <Route path="/"        element={<HomePage />} />
                <Route path="/auth"    element={<AuthPage />} />
                <Route path="/editor"  element={<EditorPage />} />
                <Route path="/analyzer" element={<AnalyzerPage />} />
                <Route path="/data"     element={<DataPage />} />
                <Route path="/gdpr"     element={<GdprPage />} />
                <Route path="/privacy"  element={<PrivacyPage />} />
                <Route path="/about"    element={<AboutPage />} />
                <Route path="/success"  element={<SuccessPage />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
