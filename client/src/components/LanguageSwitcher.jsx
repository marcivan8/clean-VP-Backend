import React from 'react';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
    { code: 'en', label: 'EN' },
    { code: 'fr', label: 'FR' },
];

/**
 * Compact EN / FR toggle for the nav or settings panel.
 * Saves preference to localStorage under the key 'vibed_lang'.
 */
export function LanguageSwitcher({ style = {} }) {
    const { i18n } = useTranslation();
    const current = i18n.language?.slice(0, 2); // normalise 'en-GB' → 'en'

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: 'var(--bg-2)',
            border: '0.5px solid var(--line)',
            borderRadius: 999,
            padding: '3px 4px',
            ...style,
        }}>
            {LANGUAGES.map(lang => {
                const active = current === lang.code;
                return (
                    <button
                        key={lang.code}
                        onClick={() => i18n.changeLanguage(lang.code)}
                        style={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            padding: '3px 10px',
                            borderRadius: 999,
                            border: 'none',
                            cursor: active ? 'default' : 'pointer',
                            background: active ? 'var(--accent)' : 'transparent',
                            color: active ? '#fff' : 'var(--fg-3)',
                            transition: 'background 0.18s, color 0.18s',
                        }}
                        aria-current={active ? 'true' : undefined}
                    >
                        {lang.label}
                    </button>
                );
            })}
        </div>
    );
}
