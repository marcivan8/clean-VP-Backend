import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import AnalyzerPage from './pages/AnalyzerPage';
import { supabase } from './lib/supabaseClient';
import useSessionStore from './store/useSessionStore';

function App() {
    const { migrateSession, isAnonymous } = useSessionStore();

    useEffect(() => {
        // When Supabase completes a sign-in (magic link, OAuth, email+password),
        // migrate any pending anonymous session to the authenticated user.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user && isAnonymous) {
                    await migrateSession(session.user.id);
                }
            }
        );
        return () => subscription.unsubscribe();
    }, [isAnonymous, migrateSession]);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/"        element={<HomePage />} />
                <Route path="/editor"  element={<EditorPage />} />
                <Route path="/analyzer" element={<AnalyzerPage />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
