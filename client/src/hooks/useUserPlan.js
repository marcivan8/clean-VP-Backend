/**
 * useUserPlan.js
 *
 * Reads the current user's subscription plan from the `profiles` table.
 * Returns 'free' for unauthenticated users or when the profile row has no plan set.
 *
 * Requires: profiles table has a `plan` column (migration 002_usage_gates.sql).
 * Requires: RLS policy allowing users to SELECT their own profile row.
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * @returns {{ plan: 'free'|'creator'|'pro', loading: boolean }}
 */
export function useUserPlan() {
    const [plan,    setPlan]    = useState('free');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        async function fetchPlan() {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) { setLoading(false); return; }

                const { data, error } = await supabase
                    .from('profiles')
                    .select('plan')
                    .eq('id', user.id)
                    .single();

                if (!cancelled) {
                    if (!error && data?.plan) setPlan(data.plan);
                    setLoading(false);
                }
            } catch (e) {
                console.warn('[useUserPlan] Could not fetch plan:', e.message);
                if (!cancelled) setLoading(false);
            }
        }

        fetchPlan();
        return () => { cancelled = true; };
    }, []);

    return { plan, loading };
}
