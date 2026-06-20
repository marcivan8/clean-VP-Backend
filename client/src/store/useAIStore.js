import { create } from 'zustand';

const useAIStore = create((set) => ({
    isAnalyzing: false,
    logs: [],
    suggestions: [],
    contextualSuggestion: null,
    quickChips: ['Remove silences', 'Clean up speech', 'Trim the intro', 'Export for YouTube'],

    // Tracks the last AI job's history boundaries so CMD+Z can undo the
    // entire batch atomically: { before: N, after: M }
    lastAIJob: null,

    // Actions
    setIsAnalyzing: (status) => set({ isAnalyzing: status }),
    setContextualSuggestion: (suggestion) => set({ contextualSuggestion: suggestion }),

    setLastAIJob: (before, after) => set({ lastAIJob: { before, after } }),
    clearLastAIJob: () => set({ lastAIJob: null }),

    addLog: (log) => set((state) => ({
        logs: [...state.logs, log]
    })),

    addSuggestion: (suggestion) => set((state) => ({
        suggestions: [...state.suggestions, suggestion]
    })),

    clearSession: () => set({ logs: [], suggestions: [], isAnalyzing: false, contextualSuggestion: null, lastAIJob: null }),

    removeSuggestion: (id) => set((state) => ({
        suggestions: state.suggestions.filter(s => s.id !== id)
    })),
}));

export default useAIStore;
