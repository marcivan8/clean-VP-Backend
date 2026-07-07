import { create } from 'zustand';

const useAIStore = create((set) => ({
    isAnalyzing: false,
    logs: [],
    suggestions: [],
    contextualSuggestion: null,
    quickChips: ['Make it more dynamic', 'Clean it up', 'Add captions', 'Export for YouTube'],

    // Actions
    setIsAnalyzing: (status) => set((state) => ({
        isAnalyzing: status,
        // Step logs are transient progress indicators — clear them when the job
        // finishes so the "Verifying edits…" spinner doesn't stay on screen forever.
        logs: status ? state.logs : state.logs.filter(l => l.type !== 'step'),
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
