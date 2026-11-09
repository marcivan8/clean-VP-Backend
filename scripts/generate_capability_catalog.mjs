/**
 * scripts/generate_capability_catalog.mjs
 *
 * Generates server/brain/commandCatalog.generated.json from the client's
 * CommandRegistry + CapabilityGraph, so the Editorial Brain's capability
 * list stops being hand-maintained.
 *
 * WHY
 * ---
 * EditorialBrain's system prompt carried this note:
 *
 *   "NOTE: this list is maintained by hand and must match the action registry
 *    in client/src/agent/CommandCompiler.js — if you add a new operation
 *    there, add it here too, or the Brain will never suggest it."
 *
 * It had drifted badly: 14 entries against 61 registered commands, so 47 real
 * capabilities were invisible to the Brain. Four of the 14 (`virtual_multicam`,
 * `split_speakers`, `remove_speaker`, `semantic_cut`) aren't registry ids at
 * all, and three (`recommend_sfx`, `recommend_presets`, plus the asset-engine
 * verbs) belong to a different vocabulary again.
 *
 * THE CANONICAL PHRASE (why this emits phrases, not just ids)
 * ----------------------------------------------------------
 * BrainPanel.handleAccept() prefers `suggestion.text` over `suggestion.command`
 * and says why: "Remove silences" matches tryLocalFirst, "remove_silences"
 * does not, "causing GPT-4o to guess". Chips re-enter through IntentParser as
 * ENGLISH. So the useful thing to hand the Brain is each command's natural
 * language, not its internal id — and the prompt was previously inconsistent
 * about this, listing snake_case ids as "exact strings" while its own schema
 * example used the phrase "remove repetition".
 *
 * Every canonical phrase emitted here is VERIFIED to round-trip:
 * resolveCommand(phrase).match.id === the command's own id. A phrase that
 * doesn't resolve back to its own command fails generation rather than
 * shipping a suggestion the parser would mis-route.
 *
 * USAGE
 *   node scripts/generate_capability_catalog.mjs          # write the catalog
 *   node scripts/generate_capability_catalog.mjs --check  # verify in sync (CI)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT  = path.join(ROOT, 'server', 'brain', 'commandCatalog.generated.json');

/**
 * Second output: the editing-style policy, as DATA the client can read.
 *
 * server/brain/editingStyles.js already holds the only structured style rules
 * in the codebase (sfxLevel, expectsMusic, keepsRecordedOrder, isCalmStyle,
 * rhythmZoomStyle, STYLE_FOCUS.aside) — but it is CommonJS on the server, and
 * client/src/agent/EditingStyles.js is a SEPARATE ESM file holding only the
 * mechanical knobs (pacing thresholds, recipe ids, transitions). So the client
 * planner had no access to "what this style must NOT do", and any copy made by
 * hand would be a fourth definition of the same rules waiting to drift.
 *
 * Generating it keeps one source (the server predicates) and makes drift a
 * test failure instead of a silent inconsistency.
 */
const STYLE_OUT = path.join(ROOT, 'client', 'src', 'agent', 'stylePolicy.generated.js');

/**
 * Third output: the id → canonical-phrase map, for the client.
 *
 * A planner that inserts a prerequisite has to produce something EXECUTABLE,
 * and the executor takes English (EditJobManager → IntentParser). It cannot
 * emit a bare id: several handlers read their parameters out of the prompt
 * text — polish_short resolves its platform with
 * `platformsFromText(args.brief)` and silently defaults to 'tiktok' when the
 * text says nothing — so a bare id would quietly lose the caller's intent.
 *
 * These are the same verified-to-route phrases the Brain catalogue uses.
 */
const PHRASE_OUT = path.join(ROOT, 'client', 'src', 'agent', 'commandPhrases.generated.js');

const registryUrl = new URL('../client/src/agent/CommandRegistry.js', import.meta.url);
const graphUrl    = new URL('../client/src/agent/CapabilityGraph.js', import.meta.url);

const reg   = await import(registryUrl.href);
const graph = await import(graphUrl.href);

const tokens = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

/**
 * The best USER-FACING phrase that provably resolves back to this command.
 *
 * Selection order, and why it is not just "the shortest":
 *   1. The registry's own `label`, when it round-trips. Labels are curated
 *      human text ("Remove silences", "Add captions") — 46 of 61 resolve to
 *      their own command, so this is the common case.
 *   2. Otherwise the round-tripping phrase with the most words in common with
 *      the label. Shortest-first picked "tighten up" for silence_removal and
 *      "undo the lut" for clear_lut — terrible chip text. Longest-first picked
 *      French ("barre de progression", "ajoute des transitions") because the
 *      registry is bilingual. Overlap with the English label avoids both.
 *   3. Ties break on longer-then-alphabetical purely so generation is
 *      deterministic and the committed JSON never churns.
 */
function canonicalPhrase(cmd) {
    const roundTrips = (text) => {
        const r = reg.resolveCommand(text);
        return !!(r.match && r.match.id === cmd.id);
    };

    if (cmd.label && roundTrips(cmd.label)) return cmd.label;

    const labelTokens = tokens(cmd.label);
    const candidates = (cmd.phrases || [])
        .filter(roundTrips)
        .map(p => ({
            phrase: p,
            overlap: [...tokens(p)].filter(t => labelTokens.has(t)).length,
        }))
        .sort((a, b) =>
            b.overlap - a.overlap
            || b.phrase.length - a.phrase.length
            || a.phrase.localeCompare(b.phrase));

    return candidates.length > 0 ? candidates[0].phrase : null;
}

const entries = [];
const failures = [];

for (const cmd of reg.COMMANDS) {
    const phrase = canonicalPhrase(cmd);
    if (!phrase) {
        failures.push(cmd.id);
        continue;
    }
    const contract = graph.contractFor(cmd.id);
    if (!contract) {
        failures.push(`${cmd.id} (no capability contract)`);
        continue;
    }
    entries.push({
        id: cmd.id,
        // The operation the pipeline actually runs. The registry lets an id
        // differ from the legacy operation name (split_by_speaker executes
        // split_speakers; macro_multicam executes virtual_multicam), which is
        // why the old hand list contained BOTH spellings and looked like it
        // had capabilities the registry lacked.
        executes: cmd.executes || cmd.id,
        phrase,
        category: cmd.category,
        registryDeclared: true,
        label: cmd.label || cmd.id,
        summary: cmd.summary || '',
        requires: contract.requires,
        prefers: contract.prefers,
        provides: contract.provides,
        destructive: contract.destructive,
        readOnly: contract.readOnly,
        macro: contract.macro,
    });
}

/**
 * Operations that EXIST in the execution layer (CommandCompiler +
 * MediaExecutionEngine + IntentParser) but are not declared in
 * CommandRegistry, so they cannot be derived from it.
 *
 * These two are reached through IntentParser's NLP_MAP in tryLocalFirst()
 * rather than through registry resolution. They were in the Brain's old hand
 * list, and dropping them while moving to a registry-generated catalogue would
 * have silently REMOVED two real capabilities — so they are carried here
 * explicitly, flagged `registryDeclared: false`.
 *
 * This is real debt, not a design: it means CommandRegistry is not yet the
 * complete source of truth its own header claims. Adopting these two into the
 * registry (with `executes` pointing at the legacy operation name, as
 * split_by_speaker already does) would let this block be deleted.
 *
 * Each phrase below is verified NOT to be intercepted by registry vocabulary.
 * If a future registry phrase starts matching one, generation fails — which
 * makes this a two-way drift detector rather than a static exception list.
 */
const SUPPLEMENT = [
    {
        id: 'remove_speaker',
        executes: 'remove_speaker',
        phrase: 'remove the interviewer',
        category: 'edit',
        label: 'Remove a speaker',
        summary: "Removes every utterance of one speaker (interviewer, host or guest).",
        requires: ['clips', 'diarization'],
        prefers: [],
        provides: [],
        destructive: true,
        readOnly: false,
        macro: null,
        registryDeclared: false,
    },
    {
        id: 'semantic_cut',
        executes: 'semantic_cut',
        phrase: 'remove the part where',
        category: 'edit',
        label: 'Cut a described moment',
        summary: 'Cuts a transcript range described in words ("where I hesitate").',
        requires: ['clips', 'transcript'],
        prefers: [],
        provides: [],
        destructive: true,
        readOnly: false,
        macro: null,
        registryDeclared: false,
    },
];

for (const extra of SUPPLEMENT) {
    const stolenBy = reg.resolveCommand(extra.phrase);
    if (stolenBy.match) {
        failures.push(
            `${extra.id}: phrase "${extra.phrase}" is now intercepted by registry command `
            + `'${stolenBy.match.id}' — it can no longer reach tryLocalFirst. Either give `
            + `${extra.id} a different trigger phrase or adopt it into CommandRegistry.`);
        continue;
    }
    if (reg.COMMAND_BY_ID[extra.id]) {
        failures.push(
            `${extra.id} is now declared in CommandRegistry — remove it from SUPPLEMENT `
            + 'in scripts/generate_capability_catalog.mjs so it is derived instead.');
        continue;
    }
    entries.push(extra);
}

if (failures.length > 0) {
    console.error('[generate_capability_catalog] FAILED — no verified phrase/contract for:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
}

entries.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

const catalog = {
    // Hand-editing this file is pointless: it is regenerated from the registry.
    $generatedBy: 'scripts/generate_capability_catalog.mjs',
    $source: 'client/src/agent/CommandRegistry.js + client/src/agent/CapabilityGraph.js',
    $doNotEdit: true,
    resources: Object.values(graph.RESOURCES).sort(),
    commandCount: entries.length,
    registryDeclaredCount: entries.filter(e => e.registryDeclared).length,
    supplementCount: entries.filter(e => !e.registryDeclared).length,
    commands: entries,
};

// Stable, newline-terminated JSON so --check is a pure content comparison and
// the file produces no diff noise between runs.
const serialized = JSON.stringify(catalog, null, 2) + '\n';

// ── style policy ────────────────────────────────────────────────────────────
const styles = require('../server/brain/editingStyles.js');

const stylePolicy = {};
for (const id of styles.EDITING_STYLE_IDS) {
    const zoom = styles.rhythmZoomStyle(id) || {};
    stylePolicy[id] = {
        id,
        label: styles.STYLE_LABEL[id] || id,
        platform: styles.platformForStyle(id),
        sfxLevel: styles.sfxLevel(id),
        expectsMusic: styles.expectsMusic(id),
        keepsRecordedOrder: styles.keepsRecordedOrder(id),
        calm: styles.isCalmStyle(id),
        allowPunchIns: zoom.allowPunchIns !== false,
        motions: zoom.motions || null,
        // Prose, carried verbatim for explanations — never parsed for decisions.
        aside: ((styles.STYLE_FOCUS[id] || {}).aside) || [],
        priorities: ((styles.STYLE_FOCUS[id] || {}).priorities) || [],
    };
}

const phraseMap = {};
for (const e of entries) phraseMap[e.id] = e.phrase;

const phraseSerialized = `/**
 * client/src/agent/commandPhrases.generated.js
 *
 * GENERATED — do not edit. Run: npm run catalog:generate
 * Source: client/src/agent/CommandRegistry.js (via the capability catalogue).
 *
 * id → the canonical natural-language phrase for that command, each one
 * verified to resolve back to its own id through resolveCommand().
 *
 * Why phrases and not ids: the executor takes English. EditJobManager hands a
 * prompt to IntentParser, and several handlers read parameters out of that
 * text (polish_short resolves its platform from the prompt and defaults to
 * 'tiktok' when nothing is named). A planner inserting a step therefore has to
 * emit a phrase, not an id.
 */

export const COMMAND_PHRASE = Object.freeze(${JSON.stringify(phraseMap, null, 4)});

/** The executable phrase for a command id, or null. */
export function phraseFor(id) {
    return COMMAND_PHRASE[id] || null;
}

export default { COMMAND_PHRASE, phraseFor };
`;

const styleSerialized = `/**
 * client/src/agent/stylePolicy.generated.js
 *
 * GENERATED — do not edit. Run: npm run catalog:generate
 * Source: server/brain/editingStyles.js (the structured style predicates).
 *
 * Exists so the client planner can read what a style must NOT do. The server
 * held those rules (sfxLevel, expectsMusic, keepsRecordedOrder, isCalmStyle,
 * rhythmZoomStyle, STYLE_FOCUS.aside) in CommonJS; the client's own
 * EditingStyles.js holds only mechanical knobs. Copying them by hand would
 * have made a fourth definition of the same rules, so they are generated and
 * drift-tested instead.
 *
 * \`aside\` and \`priorities\` are prose for explanations. Decisions are made from
 * the booleans and \`sfxLevel\`, never by parsing those strings.
 */

export const STYLE_POLICY = Object.freeze(${JSON.stringify(stylePolicy, null, 4)});

export const STYLE_POLICY_IDS = Object.freeze(${JSON.stringify(styles.EDITING_STYLE_IDS)});

/** Policy for a style id, or null when none is set / it is unknown. */
export function stylePolicy(id) {
    return STYLE_POLICY[id] || null;
}

export default { STYLE_POLICY, STYLE_POLICY_IDS, stylePolicy };
`;

const OUTPUTS = [
    { file: OUT, content: serialized, source: 'CommandRegistry / CapabilityGraph' },
    { file: STYLE_OUT, content: styleSerialized, source: 'server/brain/editingStyles.js' },
    { file: PHRASE_OUT, content: phraseSerialized, source: 'CommandRegistry (canonical phrases)' },
];

if (process.argv.includes('--check')) {
    let drifted = false;
    for (const { file, content, source } of OUTPUTS) {
        let current = null;
        try {
            current = readFileSync(file, 'utf8');
        } catch {
            console.error('[generate_capability_catalog] MISSING: ' + path.relative(ROOT, file));
            drifted = true;
            continue;
        }
        if (current !== content) {
            console.error(`[generate_capability_catalog] OUT OF SYNC: ${path.relative(ROOT, file)}`);
            console.error(`  ${source} changed without regenerating.`);
            drifted = true;
        }
    }
    if (drifted) {
        console.error('  run: node scripts/generate_capability_catalog.mjs');
        process.exit(1);
    }
    console.log(`✓ generated files in sync (${entries.length} commands, ${Object.keys(stylePolicy).length} styles)`);
    process.exit(0);
}

for (const { file, content } of OUTPUTS) writeFileSync(file, content, 'utf8');
console.log(
    `✓ wrote ${path.relative(ROOT, OUT)} — ${entries.length} commands `
    + `(${catalog.registryDeclaredCount} from the registry, ${catalog.supplementCount} supplemented), `
    + `${catalog.resources.length} resources`);
console.log(
    `✓ wrote ${path.relative(ROOT, STYLE_OUT)} — ${Object.keys(stylePolicy).length} editing styles`);
console.log(
    `✓ wrote ${path.relative(ROOT, PHRASE_OUT)} — ${Object.keys(phraseMap).length} command phrases`);
