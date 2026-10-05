import React from 'react';
import { useTranslation } from 'react-i18next';
import { STYLE_RECIPE_IDS } from '../motion/StyleRecipes.js';
import { submitRokaPrompt } from '../agent/rokaPromptQueue.js';

/**
 * R90 (to-do A6/A7): one-click style recipes and word-synced cutaways.
 * Each button sends a fixed English prompt through the assistant, so the work
 * runs in MediaExecutionEngine (apply_style_recipe / sync_cutaways) with one
 * undo step, the same as typing it.
 */
const RECIPE_PROMPT = (id) => `Apply the ${id} style recipe`;
const SYNC_PROMPT = 'Sync the b-roll and number pops to the words';

const StyleRecipePanel = () => {
    const { t } = useTranslation('editor');
    const send = (text) => {
        try {
            submitRokaPrompt(text, t);
        } catch (err) {
            console.error('[StyleRecipePanel] prompt failed:', err);
        }
    };
    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('styleRecipes.title')}</div>
            <div className="grid grid-cols-2 gap-1.5">
                {STYLE_RECIPE_IDS.map(id => (
                    <button key={id} type="button" onClick={() => send(RECIPE_PROMPT(id))}
                        title={t(`styleRecipes.hints.${id}`)}
                        className="px-2 py-1.5 rounded text-[11px] text-left transition-colors border border-border hover:bg-white/5 text-muted-foreground">
                        {t(`styleRecipes.names.${id}`)}
                    </button>
                ))}
            </div>
            <button type="button" onClick={() => send(SYNC_PROMPT)}
                className="mt-1.5 w-full px-2 py-1.5 rounded text-[11px] text-left transition-colors border border-border hover:bg-white/5 text-muted-foreground">
                {t('styleRecipes.syncCutaways')}
            </button>
            <p className="mt-1.5 text-[10px] text-muted-foreground/70">{t('styleRecipes.note')}</p>
        </div>
    );
};

export default StyleRecipePanel;
