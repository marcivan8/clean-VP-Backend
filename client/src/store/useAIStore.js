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
}));

export default useAIStore;
