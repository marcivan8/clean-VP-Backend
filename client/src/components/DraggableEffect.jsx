import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Wand2 } from 'lucide-react';

const DraggableEffect = ({ effect }) => {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: `effect-${effect.id}`,
        data: {
            type: 'effect',
            filter: effect.filter,
            name: effect.name
        }
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
        opacity: 0.8
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            style={style}
            className="aspect-square bg-secondary/30 border border-border rounded-md relative group overflow-hidden cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-2"
        >
            <div
                className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-secondary flex items-center justify-center overflow-hidden"
                style={{ filter: effect.filter }}
            >
                <Wand2 className="w-5 h-5 text-primary opacity-80" />
            </div>

            <p className="text-[10px] text-muted-foreground font-medium">{effect.name}</p>

            {/* Hint Overlay */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none text-center p-2">
                <span className="text-[10px] text-white font-medium">Drag to Clip</span>
            </div>
        </div>
    );
};

export default DraggableEffect;
