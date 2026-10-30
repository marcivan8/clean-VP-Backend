import React from 'react';

/** A small, calm working cue shared by the desktop and mobile Roka chat. */
export default function RokaWorkingIndicator({ label, className = '' }) {
    return (
        <span
            className={`roka-working-indicator ${className}`.trim()}
            role={label ? 'status' : undefined}
            aria-label={label || undefined}
            aria-hidden={label ? undefined : true}
        >
            <span className="roka-working-dots" aria-hidden="true">
                {[0, 1, 2].map(index => (
                    <span key={index} className="roka-working-dot" style={{ animationDelay: `${index * 140}ms` }} />
                ))}
            </span>
            {label && <span>{label}</span>}
        </span>
    );
}
