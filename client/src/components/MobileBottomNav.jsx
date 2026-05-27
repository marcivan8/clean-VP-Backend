import React from 'react';
import { Film, Scissors, Image as ImageIcon, Sparkles } from 'lucide-react';
import classNames from 'classnames';

const MobileBottomNav = ({ activeTab, onTabChange }) => {
    const tabs = [
        { id: 'player', icon: Film, label: 'Player' },
        { id: 'edit', icon: Scissors, label: 'Edit' },
        { id: 'media', icon: ImageIcon, label: 'Media' },
        { id: 'ai', icon: Sparkles, label: 'AI Agent' }
    ];

    return (
        <div className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border flex items-center justify-around z-50 px-2 pb-safe">
            {tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                
                return (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={classNames(
                            "flex flex-col items-center justify-center w-full h-full gap-1 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Icon className={classNames("w-5 h-5", isActive && "fill-primary/20")} />
                        <span className="text-[10px] font-medium">{tab.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default MobileBottomNav;
