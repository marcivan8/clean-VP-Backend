// scripts/test_social_destinations.mjs
// R149. Connecting a publishing destination.
//
// Weighted towards the security properties, because this feature holds
// credentials for someone else's TikTok / Instagram / YouTube account and the
// usual protection is missing by construction: the provider returns the user
// by redirecting their BROWSER to the callback, which carries no Authorization
// header, and this app authenticates with bearer tokens rather than cookies.
// So the signed state IS the authentication for that route. If it can be
// forged, an attacker attaches their account to someone else's, or worse.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'mock-anon-key';
process.env.PUBLIC_URL = 'https://vibedstudio.com';

import assert from 'assert/strict';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const { createState, readState } = require('../services/social/oauthState.js');
const { encrypt, decrypt, canEncrypt } = require('../services/social/tokenCrypto.js');
const { safeReturnTo } = require('../services/social/returnTo.js');
const P = require('../services/social/providers.js');

let n = 0;
const ok = (label) => { console.log(`  ok  ${label}`); n += 1; };

const UID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-8888-7777-6666-555555555555';

// ──────────────────────────────────────────────────────────────────────────
console.log('── 1. The state is what authenticates the callback ──');

{
    const state = createState({ userId: UID, provider: 'tiktok' });
    const read1 = readState(state, 'tiktok');
    assert.equal(read1.userId, UID);
    assert.equal(read1.provider, 'tiktok');
    ok('a state round trips to the user who started the connection');
}

{
    // The whole point: an attacker must not be able to name the user.
    const state = createState({ userId: UID, provider: 'tiktok' });
    const [payloadB64, sig] = state.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    payload.uid = OTHER;
    const forged = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${sig}`;
    assert.equal(readState(forged, 'tiktok'), null, 'swapping the user id must invalidate the state');
    ok('a state naming a different user is refused');
}

{
    const state = createState({ userId: UID, provider: 'tiktok' });
    const [payloadB64, sig] = state.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    assert.equal(readState(`${payloadB64}.${flipped}`, 'tiktok'), null);
    ok('a tampered signature is refused');
}

{
    // A state minted for one destination must not be spendable on another, or
    // a user who connected TikTok could be made to attach it as YouTube.
    const state = createState({ userId: UID, provider: 'tiktok' });
    assert.equal(readState(state, 'youtube'), null);
    assert.ok(readState(state, 'tiktok'));
    ok('a state for one destination cannot be spent on another');
}

{
    const expired = createState({ userId: UID, provider: 'tiktok', ttlMs: -1000 });
    assert.equal(readState(expired, 'tiktok'), null);
    ok('an expired state is refused');
}

for (const [label, bad] of [
    ['empty', ''],
    ['no separator', 'abcdef'],
    ['payload only', 'eyJhIjoxfQ.'],
    ['signature only', '.abc'],
    ['not base64url', '!!!.???'],
    ['absurdly long', `${'a'.repeat(5000)}.${'b'.repeat(64)}`],
    ['null', null],
    ['object', { uid: UID }],
]) {
    assert.equal(readState(bad, 'tiktok'), null, `${label} must be refused`);
}
ok('malformed states are refused without throwing');

{
    // Rotating the secret must invalidate outstanding states rather than
    // letting them through.
    const state = createState({ userId: UID, provider: 'tiktok' });
    const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-different-secret';
    const after = readState(state, 'tiktok');
    process.env.SUPABASE_SERVICE_ROLE_KEY = original;
    assert.equal(after, null, 'a state signed with the old secret must not verify under a new one');
    assert.ok(readState(state, 'tiktok'), 'and must verify again once the secret is back');
    ok('a state is only valid under the secret that signed it');
}

{
    const a = createState({ userId: UID, provider: 'tiktok' });
    const b = createState({ userId: UID, provider: 'tiktok' });
    assert.notEqual(a, b, 'a nonce must make each state distinct');
    ok('two states for the same connection are not identical');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 2. Tokens at rest ──');

assert.ok(canEncrypt(), 'a key is derivable from the service role key');

{
    const secret = 'act.example-access-token-value';
    const envelope = encrypt(secret);
    assert.notEqual(envelope, secret);
    assert.ok(!envelope.includes(secret), 'the plaintext must not appear in the envelope');
    assert.match(envelope, /^v1:/, 'the envelope is versioned so the format can change');
    assert.equal(decrypt(envelope), secret);
    ok('a token round trips and the plaintext is not in the stored value');
}

{
    // AES-GCM: a modified ciphertext must fail to authenticate rather than
    // decrypt to something arbitrary.
    const envelope = encrypt('sensitive');
    const parts = envelope.split(':');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64url');
    assert.equal(decrypt(parts.join(':')), null);
    ok('a tampered ciphertext does not decrypt');
}

{
    const envelope = encrypt('sensitive');
    const parts = envelope.split(':');
    const tag = Buffer.from(parts[2], 'base64url');
    tag[0] ^= 0xff;
    parts[2] = tag.toString('base64url');
    assert.equal(decrypt(parts.join(':')), null);
    ok('a tampered auth tag does not decrypt');
}

{
    const envelope = encrypt('sensitive');
    const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'rotated';
    const out = decrypt(envelope);
    process.env.SUPABASE_SERVICE_ROLE_KEY = original;
    // Returning null rather than throwing is what makes the account read as
    // "needs reconnect" instead of crashing a request.
    assert.equal(out, null);
    ok('a rotated key yields null rather than throwing, so the account asks for a reconnect');
}

{
    assert.equal(encrypt(null), null);
    assert.equal(encrypt(''), null);
    assert.equal(encrypt(undefined), null);
    assert.equal(decrypt(null), null);
    assert.equal(decrypt('garbage'), null);
    assert.equal(decrypt('v2:a:b:c'), null, 'an unknown version is refused');
    ok('empty and malformed values are handled without throwing');
}

{
    assert.notEqual(encrypt('same'), encrypt('same'), 'a random IV must make two encryptions differ');
    ok('encrypting the same token twice gives different ciphertext');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 3. The redirect target cannot leave the site ──');

for (const bad of [
    '//evil.com', 'https://evil.com', 'http://evil.com', 'javascript:alert(1)',
    '/\\evil.com', '/foo:bar', 'editor', '', null, undefined, 42,
    '/\u0000/evil', '/a\nb', `/${'x'.repeat(600)}`,
]) {
    assert.equal(safeReturnTo(bad), '/editor', `${JSON.stringify(bad)} must fall back`);
}
assert.equal(safeReturnTo('/editor'), '/editor');
assert.equal(safeReturnTo('/project/abc'), '/project/abc');
ok('only relative in-app paths survive, everything else becomes /editor');

// ──────────────────────────────────────────────────────────────────────────
console.log('── 4. The destination registry ──');

{
    const ids = P.listProviders().map((p) => p.id);
    assert.deepEqual(ids, ['tiktok', 'instagram', 'youtube']);
    assert.equal(P.getProvider('nope'), null);
    // Object lookups reached by a user supplied string: '__proto__' and
    // 'constructor' must not resolve to anything.
    assert.equal(P.getProvider('__proto__'), null);
    assert.equal(P.getProvider('constructor'), null);
    assert.equal(P.getProvider('toString'), null);
    ok('the registry lists three destinations and resolves nothing it should not');
}

{
    // No credentials in this environment, so nothing is offered as connectable.
    for (const p of P.listProviders()) {
        assert.equal(P.isConfigured(p), false, `${p.id} must not claim to be configured without credentials`);
    }
    ok('a destination without credentials reports itself unconfigured');
}

{
    const shape = P.publicShape(P.getProvider('tiktok'));
    assert.deepEqual(Object.keys(shape).sort(), ['configured', 'id', 'label', 'publishReady', 'reviewNote']);
    const serialised = JSON.stringify(shape);
    assert.ok(!/secret|client_?key|token/i.test(serialised), 'the browser shape must carry no credential or env var name');
    ok('what the browser is told contains no secret and no env var name');
}

{
    assert.equal(P.redirectUri('tiktok'), 'https://vibedstudio.com/api/social/tiktok/callback');
    const original = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = '';
    process.env.FRONTEND_URL = '';
    assert.equal(P.redirectUri('tiktok'), '', 'with no public URL there is no redirect uri, and connect refuses');
    process.env.PUBLIC_URL = original;
    ok('the redirect uri comes from server config, so a request cannot choose it');
}

{
    process.env.TIKTOK_CLIENT_KEY = 'tk-id';
    process.env.TIKTOK_CLIENT_SECRET = 'tk-secret';
    const tiktok = P.getProvider('tiktok');
    assert.ok(P.isConfigured(tiktok));
    const url = new URL(P.authorizeUrl(tiktok, 'the-state'));
    // TikTok uses client_key; sending client_id fails with a generic error.
    assert.equal(url.searchParams.get('client_key'), 'tk-id');
    assert.equal(url.searchParams.get('client_id'), null);
    assert.equal(url.searchParams.get('state'), 'the-state');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://vibedstudio.com/api/social/tiktok/callback');
    assert.ok(!url.toString().includes('tk-secret'), 'the client secret must never reach the authorize URL');
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    ok('the TikTok consent URL carries client_key, the state and no secret');
}

{
    process.env.YOUTUBE_CLIENT_ID = 'g-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'g-secret';
    const yt = P.getProvider('youtube');
    const url = new URL(P.authorizeUrl(yt, 's'));
    // Without these Google issues no refresh token and the connection dies
    // after an hour, which looks like a bug in VIBED rather than a missing
    // parameter.
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.match(url.searchParams.get('scope'), /youtube\.upload/);
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
    ok('the YouTube consent URL asks for offline access, so a refresh token is issued');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 5. What the API returns about a connection ──');

{
    const { publicAccount } = require('../services/social/accounts.js');
    const row = {
        provider: 'tiktok',
        handle: '@marc',
        access_token: encrypt('secret-access'),
        refresh_token: encrypt('secret-refresh'),
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        connected_at: new Date().toISOString(),
        external_id: 'open-id-123',
        scopes: 'video.upload',
    };
    const out = publicAccount(row);
    const serialised = JSON.stringify(out);
    assert.ok(!serialised.includes('secret-access'), 'no access token');
    assert.ok(!serialised.includes('secret-refresh'), 'no refresh token');
    assert.ok(!serialised.includes(row.access_token), 'not even the encrypted envelope');
    assert.deepEqual(Object.keys(out).sort(), ['connectedAt', 'expiresAt', 'handle', 'needsReconnect', 'provider']);
    assert.equal(out.needsReconnect, false);
    ok('a connection is reported without any token, encrypted or otherwise');
}

{
    const { publicAccount } = require('../services/social/accounts.js');
    // Key rotated: the row exists but cannot be used.
    assert.equal(publicAccount({ provider: 'tiktok', access_token: 'v1:a:b:c' }).needsReconnect, true);
    // Expired with no refresh token is equally dead.
    assert.equal(publicAccount({
        provider: 'tiktok',
        access_token: encrypt('a'),
        refresh_token: null,
        expires_at: new Date(Date.now() - 1000).toISOString(),
    }).needsReconnect, true);
    // Expired but refreshable is fine; the publish path will refresh it.
    assert.equal(publicAccount({
        provider: 'tiktok',
        access_token: encrypt('a'),
        refresh_token: encrypt('r'),
        expires_at: new Date(Date.now() - 1000).toISOString(),
    }).needsReconnect, false);
    ok('an unusable connection says so rather than looking healthy');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('── 6. How the routes are wired ──');

const routes = read('../routes/socialRoutes.js');

{
    // The callback cannot be authenticated, by construction. This pins that it
    // is a deliberate choice next to the state check, not an oversight.
    const callback = routes.slice(routes.indexOf("router.get('/:provider/callback'"));
    const handlerLine = callback.slice(0, callback.indexOf('\n'));
    assert.ok(!handlerLine.includes('authenticateUser'),
        'the callback cannot use authenticateUser: a provider redirect carries no Authorization header');
    const body = callback.slice(0, 1200);
    assert.match(body, /readState\(req\.query\.state, provider\.id\)/,
        'the callback must verify the signed state, which is its only authentication');
    // Anything read from the query before the state is verified is acting on
    // an unauthenticated request.
    assert.ok(body.indexOf('readState') < body.indexOf('req.query.error'),
        'the state must be verified before anything else in the query is used');
    assert.ok(body.indexOf('readState') < body.indexOf('req.query.code'),
        'the state must be verified before the code is read');
    ok('the callback verifies the state first and uses it as the identity');
}

{
    for (const authed of ["router.get('/accounts'", "router.delete('/:provider'", "router.post('/:provider/connect'"]) {
        const line = routes.slice(routes.indexOf(authed));
        assert.match(line.slice(0, line.indexOf('\n')), /authenticateUser/,
            `${authed} must be authenticated`);
    }
    ok('every route that is not the callback is authenticated');
}

{
    // A connect that sends the user to a consent screen whose result cannot be
    // stored spends their trust for nothing.
    assert.match(routes, /canEncrypt\(\)/, 'connect refuses when tokens could not be stored');
    assert.match(routes, /isConfigured\(provider\)/, 'connect refuses an unconfigured destination');
    assert.match(routes, /PROVIDER_NOT_CONFIGURED/);
    ok('connect refuses up front rather than failing after the user consents');
}

{
    // A failed exchange can echo the authorization code back, and a successful
    // one holds the token, so check every log statement in the file rather
    // than one line: the rule is that none of them touch the payload.
    const logCalls = [
        ...routes.matchAll(/console\.(?:log|warn|error|info|debug)\(([\s\S]*?)\);/g),
    ].map((m) => m[1]);
    assert.ok(logCalls.length > 0, 'there should be some logging to check');
    for (const call of logCalls) {
        assert.ok(!/payload/.test(call), `a log statement references the token payload: ${call.trim()}`);
        assert.ok(!/access_token|refresh_token/.test(call), `a log statement references a token: ${call.trim()}`);
        assert.ok(!/\bcode\b/.test(call), `a log statement references the authorization code: ${call.trim()}`);
        assert.ok(!/req\.query/.test(call), `a log statement dumps the query: ${call.trim()}`);
    }
    // The status alone is what makes a failed exchange debuggable.
    assert.match(routes, /token exchange failed: \$\{response\.status\}/);
    ok('no log statement touches the authorization code, the payload or a token');
}

{
    // The client navigates to the URL; a 302 here would be followed by fetch()
    // rather than the browser.
    const connect = routes.slice(routes.indexOf("router.post('/:provider/connect'"));
    const body = connect.slice(0, connect.indexOf('router.get'));
    assert.match(body, /res\.json\(\{ url:/, 'connect returns a URL rather than redirecting');
    assert.ok(!/res\.redirect/.test(body), 'connect must not 302: a bearer authenticated XHR cannot navigate');
    ok('connect hands back a URL for the client to navigate to');
}

{
    const index = read('../index.js');
    assert.match(index, /app\.use\('\/api\/social', authLimiter, require\('\.\/routes\/socialRoutes'\)\)/,
        'the routes must be mounted, behind the failure-counting limiter');
    ok('the routes are mounted behind a limiter that throttles forged states');
}

{
    const migration = read('../migrations/009_social_accounts.sql');
    assert.match(migration, /enable row level security/);
    assert.match(migration, /revoke all on public\.social_accounts from anon, authenticated/,
        'the browser must have no privilege on the token table');
    // The comments explain WHY a policy would be a mistake, so strip them
    // before checking that none is actually created.
    const sql = migration.replace(/--[^\n]*/g, '');
    assert.ok(!/create policy/i.test(sql), 'a policy here would be a way to expose tokens');
    assert.match(migration, /unique \(user_id, provider\)/, 'reconnecting must replace, not accumulate');
    ok('the token table is unreachable from the browser by grant, not only by RLS');
}

// ──────────────────────────────────────────────────────────────────────────
console.log('\u2500\u2500 7. The browser side \u2500\u2500');

// Comments in these files explain the reasoning, and that prose contains the
// very words some of these checks look for ("a Post button that fails"). Strip
// them so the assertions are about the code.
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const clientApi = stripComments(read('../client/src/lib/socialDestinations.js'));
const ui = stripComments(read('../client/src/components/ShareDestinations.jsx'));
const sheet = stripComments(read('../client/src/components/MobileExportSheet.jsx'));

{
    // The browser is never given a token, so it must never look for one.
    for (const [name, src] of [['socialDestinations.js', clientApi], ['ShareDestinations.jsx', ui]]) {
        assert.ok(!/access_token|refresh_token/.test(src), `${name} must not reference a token`);
        assert.ok(!/from '.*supabaseClient/.test(src), `${name} must not query the table directly`);
    }
    ok('the client never touches a token or the table');
}

{
    // A 302 from /connect would be followed by fetch(), not by the browser, so
    // the user would never see the consent screen.
    assert.match(clientApi, /window\.location\.href = body\.url/, 'the client navigates to the consent URL');
    assert.match(clientApi, /method: 'POST'/);
    assert.match(clientApi, /encodeURIComponent\(provider\)/, 'the provider goes in the path, so it must be encoded');
    ok('connect posts, then navigates the browser to the URL it gets back');
}

{
    // Left in the URL, a refresh would re-announce a connection that already
    // happened, and ?connected= would survive in anything the user shares.
    assert.match(clientApi, /params\.delete\('connected'\)/);
    assert.match(clientApi, /params\.delete\('social_error'\)/);
    assert.match(clientApi, /history\.replaceState/);
    ok('the round trip result is cleared from the URL once read');
}

{
    assert.match(sheet, /<ShareDestinations \/>/, 'the sheet must render the destinations');
    // Save and Share must survive: the phone's own share sheet already reaches
    // TikTok and Instagram, whatever the API review says.
    assert.match(sheet, /navigator\.share/, 'Share must still exist');
    assert.match(sheet, /downloadFile/, 'the download fallback must still exist');
    ok('destinations sit alongside Save and Share rather than replacing them');
}

{
    // Nothing is publishReady yet, so the UI must say so rather than imply it
    // can post.
    assert.ok(P.listProviders().every((p) => !p.publishReady), 'no destination can publish yet');
    assert.match(ui, /reviewPending/, 'the UI must explain that posting needs app review');
    assert.ok(!/Post\b/.test(ui), 'there must be no Post button while nothing can publish');
    ok('the UI does not offer a Post button it cannot honour');
}

{
    for (const lang of ['en', 'fr']) {
        const j = JSON.parse(read(`../client/src/locales/${lang}/editor.json`));
        const block = j.shareDestinations;
        assert.ok(block, `${lang} shareDestinations missing`);
        for (const k of [
            'title', 'connect', 'disconnect', 'reconnect', 'connected', 'notConnected',
            'notAvailable', 'needsReconnect', 'connectedNotice', 'reviewPending',
            'error_GENERIC', 'error_declined', 'error_expired', 'error_exchange_failed',
            'error_PROVIDER_NOT_CONFIGURED', 'error_CONNECT_FAILED', 'error_DISCONNECT_FAILED',
        ]) {
            assert.ok(block[k], `${lang} shareDestinations.${k} missing`);
            assert.ok(!/\u2014/.test(block[k]), `${lang} shareDestinations.${k} has an em dash`);
        }
    }
    ok('every destination string exists in both languages, with no em dashes');
}

{
    // Each error the server can hand back needs copy, or the user gets the
    // generic line for a case we already know how to explain.
    const serverErrors = [...routes.matchAll(/social_error: '([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(serverErrors.length >= 4, 'the callback reports several distinct failures');
    const en = JSON.parse(read('../client/src/locales/en/editor.json')).shareDestinations;
    for (const code of new Set(serverErrors)) {
        assert.ok(en[`error_${code}`], `no copy for social_error=${code}`);
    }
    ok('every failure the callback reports has its own message');
}

console.log(`\n${n} checks passed.`);
