const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Pour les opérations admin
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY; // Pour les clients

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

module.exports = { supabaseAdmin, supabaseClient };
