/**
 * client/src/components/Player/SnapGuidesLayer.jsx
 *
 * R92 round C: draws the alignment guides while something is being dragged
 * on the player (motion/SnapGuides.js decides where they are). Thin lines
 * across the frame: centre lines in the accent colour, everything else in a
 * quieter tone. Not interactive, not exported.
 */
import React from 'react';
import { create } from 'zustand';

/** Guides currently shown. Written by the drag handlers, cleared on release. */
export const useSnapGuides = create(set => ({
    guides: [],
    setGuides: (guides) => set({ guides: Array.isArray(guides) ? guides : [] }),
    clear: () => set({ guides: [] }),
}));

export default function SnapGuidesLayer() {
    const guides = useSnapGuides(s => s.guides);
    if (!guides.length) return null;
    return (
        <div className="absolute inset-0 pointer-events-none z-20" aria-hidden="true">
            {guides.map((g, i) => {
                const strong = g.kind === 'center';
                const color = strong ? 'rgba(255,0,170,0.95)' : g.kind === 'element' ? 'rgba(0,229,255,0.9)' : 'rgba(255,255,255,0.55)';
                const style = g.axis === 'x'
                    ? { left: `${g.pos}%`, top: 0, bottom: 0, width: 0, borderLeft: `1px ${strong ? 'solid' : 'dashed'} ${color}` }
                    : { top: `${g.pos}%`, left: 0, right: 0, height: 0, borderTop: `1px ${strong ? 'solid' : 'dashed'} ${color}` };
                return <div key={`${g.axis}-${i}-${g.pos}`} className="absolute" style={style} />;
            })}
        </div>
    );
}
