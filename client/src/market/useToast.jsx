/**
 * client/src/market/useToast.jsx — feedback for market store actions (R100).
 * Kept apart from ui.jsx so that file exports components only (fast refresh).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cx } from './uiUtils.js';

/**
 * Feedback for store actions: shows the error a store action returned, or a
 * short success line. Actions return { ok, error } (R30), so a refusal is
 * always explained rather than silently ignored.
 */
export function useToast() {
    const [toast, setToast] = useState(null);
    useEffect(() => {
        if (!toast) return undefined;
        const t = setTimeout(() => setToast(null), 3800);
        return () => clearTimeout(t);
    }, [toast]);
    const report = useCallback((result, successText) => {
        if (result?.ok) setToast({ text: successText, error: false });
        else setToast({ text: result?.error || 'That did not work.', error: true });
        return result;
    }, []);
    const node = toast ? (
        <div className={cx('mk-toast', toast.error && 'is-error')} role="status" aria-live="polite">{toast.text}</div>
    ) : null;
    return { report, toastNode: node };
}
