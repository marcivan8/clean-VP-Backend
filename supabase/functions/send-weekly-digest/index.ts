// supabase/functions/send-weekly-digest/index.ts
// Invoked weekly by pg_cron (see migrations/005_email_triggers.sql).
// Queries usage data for all active creator/pro users and sends the weekly digest.
//
// Deploy: supabase functions deploy send-weekly-digest
// Required secrets: RESEND_API_KEY, PUBLIC_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_URL    = Deno.env.get('PUBLIC_URL') ?? 'https://www.viralpilot.fr';
const SEND_EMAIL_FN = `${SUPABASE_URL}/functions/v1/send-email`;
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY') ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bGVjY3RpZmdjdHJnaGx2bmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5ODY2MDAsImV4cCI6MjA3MDU2MjYwMH0.bJR3TLmfea-zLwrZ_C8LRoRSN68s0BSgn0zfkOV0hxQ';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function formatTimeSaved(opCount: number): string {
  // Heuristic: each AI op saves ~8 minutes of manual editing
  const minutes = opCount * 8;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatRelativeTime(date: Date): string {
  const diffMs  = Date.now() - date.getTime();
  const diffH   = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1)  return 'moments';
  if (diffH < 24) return `${diffH} hour${diffH > 1 ? 's' : ''}`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} day${diffD > 1 ? 's' : ''}`;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Fetch all creator/pro users with their emails
  const { data: profiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id, plan')
    .in('plan', ['creator', 'pro']);

  if (profileErr || !profiles?.length) {
    console.log('[send-weekly-digest] No paid users or error:', profileErr?.message);
    return new Response(JSON.stringify({ sent: 0 }), { headers: CORS });
  }

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const weekDate = weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let sentCount = 0;

  for (const profile of profiles) {
    try {
      // 2. Get auth user email + name
      const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(profile.id);
      if (userErr || !user?.email) continue;

      const firstName = (user.user_metadata?.full_name as string ?? user.email).split(' ')[0];

      // 3. Count usage events this week
      const { count: opsCount } = await supabase
        .from('usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .gte('created_at', weekStart.toISOString());

      const clipsEdited = opsCount ?? 0;

      // Skip users who did nothing this week
      if (clipsEdited === 0) continue;

      // 4. Get last edited project
      const { data: lastProject } = await supabase
        .from('projects')
        .select('name, updated_at')
        .eq('user_id', profile.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      const lastProjectName = lastProject?.name ?? 'Untitled Project';
      const lastEditedTime  = lastProject?.updated_at
        ? formatRelativeTime(new Date(lastProject.updated_at))
        : 'a while';

      // 5. Dispatch send-email
      await fetch(SEND_EMAIL_FN, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          type: 'weekly',
          to:   user.email,
          data: {
            first_name:        firstName,
            week_date:         weekDate,
            clips_edited:      clipsEdited,
            time_saved:        formatTimeSaved(clipsEdited),
            last_project_name: lastProjectName,
            last_edited_time:  lastEditedTime,
            cta_url:           `${PUBLIC_URL}/dashboard`,
            account_url:       `${PUBLIC_URL}/account`,
            unsubscribe_url:   `${PUBLIC_URL}/unsubscribe?uid=${profile.id}`,
          },
        }),
      });

      sentCount++;
    } catch (err) {
      console.error(`[send-weekly-digest] Failed for user ${profile.id}:`, err);
    }
  }

  console.log(`[send-weekly-digest] Sent to ${sentCount} users`);
  return new Response(JSON.stringify({ sent: sentCount }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
