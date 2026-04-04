import React from 'react';
import useTimelineStore from '../../store/useTimelineStore';
import { motion, AnimatePresence } from 'framer-motion';

// We don't have framer-motion installed? 
// Let's check package.json or use simple CSS animation.
// User said "Install IDE dependencies" in Phase 1, but maybe not framer-motion.
// I'll stick to CSS for safety and speed.

const CaptionOverlay = () => {
    const { currentTime, captions } = useTimelineStore();

    if (!captions || captions.length === 0) return null;

    // Find active word
    // We add a small buffer (0.1s) to make it feel snappier?
    // Start <= current <= End
    const activeWord = captions.find(w => currentTime >= w.start && currentTime <= w.end);

    // If no exact match (silence), show nothing
    if (!activeWord) return null;

    return (
        <div className="absolute bottom-16 left-0 right-0 flex justify-center items-center pointer-events-none z-20">
            <div className="text-center px-4">
                <span
                    key={activeWord.word + activeWord.start} // Key change triggers animation re-run
                    className="
                        inline-block 
                        text-5xl font-black text-yellow-400 
                        uppercase tracking-wide
                        drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]
                        stroke-black stroke-2
                        animate-pop-in
                    "
                    style={{
                        textShadow: '2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'
                    }}
                >
                    {activeWord.word}
                </span>
            </div>
        </div>
    );
};

export default CaptionOverlay;
