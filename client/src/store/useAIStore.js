import { create } from 'zustand';

const useAIStore = create((set) => ({
    isAnalyzing: false,
    logs: [],
    suggestions: [],
    contextualSuggestion: null,
    quickChips: ['Remove silences', 'Clean up speech', 'Trim the intro', 'Export for YouTube'],

    // Actions
    setIsAnalyzing: (status) => set({ isAnalyzing: status }),
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
