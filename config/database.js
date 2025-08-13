// ===== config/database.js =====
const { createClient } = require('@supabase/supabase-js');

// Validation des variables d'environnement requises
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Client admin pour opérations serveur avec service role key
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Client pour validation tokens utilisateurs
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

module.exports = { supabaseAdmin, supabaseClient };