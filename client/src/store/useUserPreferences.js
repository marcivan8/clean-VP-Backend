import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * User Preferences Store (The "Memory")
 * Tracks user behavior to refine AI suggestions over time.
 */
const useUserPreferences = create(
    persist(
        (set, get) => ({
            // Tracking Stats
            stats: {
                accepted_silence: 0,
                rejected_silence: 0,
                accepted_music: 0,
                rejected_music: 0,
                accepted_captions: 0,
                rejected_captions: 0
            },

            // Learned Defaults (Thresholds)
            settings: {
                autoSilenceRemoval: false, // Turn on if accepted > 3
                preferredMusicGenre: null, // "Upbeat", "Cinematic"
                alwaysAddCaptions: false
            },

            // Actions
            recordDecision: (type, accepted, data = {}) => set((state) => {
                const newStats = { ...state.stats };
                const newSettings = { ...state.settings };

                // Update Stats
                if (type === 'silence') {
                    if (accepted) newStats.accepted_silence++;
                    else newStats.rejected_silence++;

                    // Learn: Enable Auto-Silence?
                    if (newStats.accepted_silence >= 3 && newStats.rejected_silence === 0) {
                        newSettings.autoSilenceRemoval = true;
                    }
                }

                if (type === 'music') {
                    if (accepted) {
                        newStats.accepted_music++;
                        if (data.genre) newSettings.preferredMusicGenre = data.genre;
                    } else {
                        newStats.rejected_music++;
                    }
                }

                if (type === 'captions') {
                    if (accepted) newStats.accepted_captions++;
                    else newStats.rejected_captions++;

                    if (newStats.accepted_captions >= 3) {
                        newSettings.alwaysAddCaptions = true;
                    }
                }

                return { stats: newStats, settings: newSettings };
            }),

            resetMemory: () => set({
                stats: { accepted_silence: 0, rejected_silence: 0, accepted_music: 0, rejected_music: 0, accepted_captions: 0, rejected_captions: 0 },
                settings: { autoSilenceRemoval: false, preferredMusicGenre: null, alwaysAddCaptions: false }
            })
        }),
        {
            name: 'vp-user-memory', // LocalStorage key
            getStorage: () => localStorage,
        }
    )
);

export default useUserPreferences;
