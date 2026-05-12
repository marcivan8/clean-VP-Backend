// client/src/lib/supabaseClient.js
//
// Singleton Supabase browser client.
// Env vars are injected by Vite at build time — they MUST be prefixed VITE_.
// In Railway: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as build variables.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error(
        '[supabaseClient] Missing env vars.\n' +
        '  VITE_SUPABASE_URL  →', supabaseUrl  ?? '❌ not set', '\n' +
        '  VITE_SUPABASE_ANON_KEY →', supabaseKey ? '✅ set' : '❌ not set'
    );
}

export const supabase = createClient(
    supabaseUrl  ?? 'https://placeholder.supabase.co',
    supabaseKey  ?? 'placeholder-anon-key'
);
