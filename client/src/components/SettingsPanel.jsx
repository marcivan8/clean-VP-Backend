import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';

const SettingsPanel = () => {
    const { aspectRatio, setAspectRatio } = useTimelineStore(useShallow(state => ({
        aspectRatio:    state.aspectRatio,
        setAspectRatio: state.setAspectRatio,
    })));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Settings</div>
            </div>

            {/* Project Settings */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Project Settings</h3>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Aspect Ratio</label>
                    <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="w-full bg-secondary text-foreground text-xs p-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="16:9">16:9 (Landscape)</option>
                        <option value="9:16">9:16 (Portrait)</option>
                        <option value="1:1">1:1 (Square)</option>
                        <option value="4:3">4:3 (Standard)</option>
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Preview Quality</label>
                    <select
                        value={useTimelineStore.getState().previewQuality ?? 'high'}
                        onChange={(e) => useTimelineStore.getState().setPreviewQuality(e.target.value)}
                        className="w-full bg-secondary text-foreground text-xs p-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="high">High (Full Res)</option>
                        <option value="low">Low (Optimized)</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground">Low quality improves performance on scrubbing.</p>
                </div>
            </div>

            <div className="h-px bg-border my-2" />

            {/* Keyboard Shortcuts */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h3>

                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-muted-foreground">Undo</div>
                    <div className="text-foreground font-mono text-right">Ctrl + Z</div>

                    <div className="text-muted-foreground">Redo</div>
                    <div className="text-foreground font-mono text-right">Ctrl + Y</div>

                    <div className="text-muted-foreground">Split Clip</div>
                    <div className="text-foreground font-mono text-right">S</div>

                    <div className="text-muted-foreground">Delete Clip</div>
                    <div className="text-foreground font-mono text-right">Del / Backspace</div>

                    <div className="text-muted-foreground">Play / Pause</div>
                    <div className="text-foreground font-mono text-right">Space</div>
                </div>
            </div>

            <div className="h-px bg-border my-2" />

            <div className="p-3 rounded-md bg-secondary/50 text-[10px] text-muted-foreground">
                <p>Version 0.9.0 (Beta)</p>
                <p className="mt-1">Vibed Editor</p>
            </div>
        </div>
    );
};

export default SettingsPanel;
