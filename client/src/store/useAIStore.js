import { create } from 'zustand';

const useAIStore = create((set) => ({
    isAnalyzing: false,
    logs: [],
    suggestions: [],

    // Actions
    setIsAnalyzing: (status) => set({ isAnalyzing: status }),

    addLog: (log) => set((state) => ({
        logs: [...state.logs, log]
    })),

    addSuggestion: (suggestion) => set((state) => ({
        suggestions: [...state.suggestions, suggestion]
    })),

    clearSession: () => set({ logs: [], suggestions: [], isAnalyzing: false }),

    removeSuggestion: (id) => set((state) => ({
        suggestions: state.suggestions.filter(s => s.id !== id)
    })),
}));

export default useAIStore;
