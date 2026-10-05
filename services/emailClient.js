// services/emailClient.js
// Calls the send-email Supabase edge function from the backend.
//
// Authenticates with the service role key. The function refuses the public
// anon key for everything except a verified welcome email, so server code
// must never fall back to SUPABASE_ANON_KEY here.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_SECRET = process.env.EMAIL_FUNCTION_SECRET;

/**
 * Send a transactional email. Resolves to true when the function accepted it.
 * Never throws: callers treat email as best effort unless they check the result.
 */
async function sendTransactionalEmail(type, to, data = {}, { timeoutMs = 15000 } = {}) {
    if (!SUPABASE_URL || (!SERVICE_KEY && !EMAIL_SECRET)) {
        console.warn(`[email] ${type} not sent: SUPABASE_URL or service key missing`);
        return false;
    }
    if (!type || !to) return false;

    const headers = { 'Content-Type': 'application/json' };
    if (SERVICE_KEY) headers.Authorization = `Bearer ${SERVICE_KEY}`;
    if (EMAIL_SECRET) headers['x-email-secret'] = EMAIL_SECRET;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ type, to, data }),
            signal: controller.signal,
        });
        if (!res.ok) {
            console.warn(`[email] ${type} rejected by send-email (HTTP ${res.status})`);
            return false;
        }
        return true;
    } catch (err) {
        console.warn(`[email] ${type} failed:`, err.message);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { sendTransactionalEmail };
