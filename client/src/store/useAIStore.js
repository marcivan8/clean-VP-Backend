import { create } from 'zustand';

const useAIStore = create((set) => ({
    isAnalyzing: false,
    logs: [],
    suggestions: [],
    contextualSuggestion: null,
    quickChips: ['Make it more dynamic', 'Clean it up', 'Add captions', 'Export for YouTube'],
    activeTab: 'media',

    // Actions
    setActiveTab: (tab) => set({ activeTab: tab }),
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
        logs: [...state.logs, log]
    })),

    addSuggestion: (suggestion) => set((state) => ({
        suggestions: [...state.suggestions, suggestion]
    })),

    clearSession: () => set({ logs: [], suggestions: [], isAnalyzing: false, contextualSuggestion: null }),

    removeSuggestion: (id) => set((state) => ({
        suggestions: state.suggestions.filter(s => s.id !== id)
    })),
}));

export default useAIStore;
