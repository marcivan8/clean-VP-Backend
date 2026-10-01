import { create } from 'zustand';

// Monotonic counter stamped onto every log AND suggestion as they are created.
// ReasoningPanel merges the two collections into ONE chronological stream, and
// it can't sort on `timestamp` because that field is a locale-formatted
// 12-hour string ("3:45:12 PM") — not reliably comparable. A plain incrementing
// integer is unambiguous and never ties.
let _seqCounter = 0;
const nextSeq = () => ++_seqCounter;

const useAIStore = create((set) => ({
    isAnalyzing: false,
    logs: [],
    suggestions: [],
    contextualSuggestion: null,
    quickChips: ['Make it more dynamic', 'Clean it up', 'Add captions', 'Export for YouTube'],
    activeTab: 'media',

    // Actions
    setActiveTab: (tab) => set({ activeTab: tab }),
    // Quick chips are refreshed from SuggestionEngine after every applied edit,
    // so they track the real project state instead of staying the fixed four
    // strings this store was initialised with.
    setQuickChips: (chips) => set(state =>
        Array.isArray(chips) && chips.length ? { quickChips: chips } : state
    ),
    setIsAnalyzing: (status) => set((state) => ({
        isAnalyzing: status,
        // When a job finishes, mark pending step logs as done so they switch from
        // a spinner to a checkmark and stay visible as an execution trail.
        // When a new job starts (status=true) leave existing logs untouched.
        logs: status
            ? state.logs
            : state.logs.map(l => l.type === 'step' ? { ...l, done: true } : l),
    })),
    setContextualSuggestion: (suggestion) => set({ contextualSuggestion: suggestion }),

    addLog: (log) => set((state) => ({
        logs: [...state.logs, { ...log, _seq: log._seq ?? nextSeq(), _at: log._at ?? Date.now() }]
    })),

    addSuggestion: (suggestion) => set((state) => ({
        suggestions: [...state.suggestions, { ...suggestion, _seq: suggestion._seq ?? nextSeq(), _at: suggestion._at ?? Date.now() }]
    })),

    clearSession: () => set({ logs: [], suggestions: [], isAnalyzing: false, contextualSuggestion: null }),

    removeSuggestion: (id) => set((state) => ({
        suggestions: state.suggestions.filter(s => s.id !== id)
    })),

    // Mobile: Roka requests typed while the video is still uploading /
    // preparing wait here and run once it can play (agent/rokaPromptQueue.js).
    queuedPrompts: [],
    enqueuePrompt: (text) => set((state) => ({
        queuedPrompts: [...state.queuedPrompts, { id: 'q-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), text }],
    })),
    shiftQueuedPrompt: () => {
        let first = null;
        set((state) => {
            if (state.queuedPrompts.length === 0) return state;
            first = state.queuedPrompts[0];
            return { queuedPrompts: state.queuedPrompts.slice(1) };
        });
        return first;
    },
    clearQueuedPrompts: () => set({ queuedPrompts: [] }),

    // Mobile: what the user did with an applied AI edit ('kept' | 'undone'),
    // by its task_complete log id, so the Roka bar card and the preview toast agree.
    // Caption generation over several videos (MediaExecutionEngine
    // _captionMainTrackSources): null, or { files: [{ key, name, state }] }
    // with state 'done' | 'running' | 'waiting' | 'failed'. Mobile Roka bar shows it.
    // Set when the server reports the monthly AI-operations cap ({ upgradeRequired }).
    // Mobile Roka bar shows a hint; it resets on reload (e.g. after checkout).
    // { name, at } while a picked video is being opened (probed) before its
    // upload starts; null otherwise. Drives the mobile "Opening" card.
    openingFile: null,
    setOpeningFile: (openingFile) => set({ openingFile }),
    aiOpsExhausted: null,
    setAiOpsExhausted: (aiOpsExhausted) => set({ aiOpsExhausted }),
    captionProgress: null,
    setCaptionProgress: (captionProgress) => set({ captionProgress }),

    // Mobile caption sheets: null | { kind: 'style' } | { kind: 'edit', placementId }
    mobileCaptionSheet: null,
    openMobileCaptionSheet: (kind, placementId = null) => set({ mobileCaptionSheet: { kind, placementId } }),
    closeMobileCaptionSheet: () => set({ mobileCaptionSheet: null }),

    // Mobile transcript sheet (MobileTranscriptSheet)
    mobileTranscriptOpen: false,
    setMobileTranscriptOpen: (open) => set({ mobileTranscriptOpen: !!open }),

    taskOutcomes: {},
    setTaskOutcome: (logId, outcome) => set((state) => ({ taskOutcomes: { ...state.taskOutcomes, [logId]: outcome } })),
}));

export default useAIStore;
