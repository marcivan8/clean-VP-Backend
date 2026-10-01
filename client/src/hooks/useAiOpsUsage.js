/**
 * useAiOpsUsage — AI operations used this month, counted from the user's own
 * usage_events rows (RLS "own rows read", migration 002_usage_gates.sql),
 * from the 1st at 00:00 UTC: the same window middleware/usageGate.js gates on.
 * Read-only; `used` stays null when it can't be read (the meter then hides).
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { startOfUsageMonth } from '../lib/planLimits.js';

export function useAiOpsUsage(refreshKey, enabled = true) {
    const [used, setUsed] = useState(null);

    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        async function load() {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                const { count, error } = await supabase
                    .from('usage_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user.id)
                    .gte('created_at', startOfUsageMonth().toISOString());
                if (error) throw error;
                if (!cancelled) setUsed(count ?? 0);
            } catch (err) {
                console.warn('[useAiOpsUsage] could not read usage:', err.message);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [refreshKey, enabled]);

    return { used };
}
