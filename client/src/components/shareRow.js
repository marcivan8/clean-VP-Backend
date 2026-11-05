/**
 * shareRow.js
 *
 * The look of a destination row on the share screen, from the design
 * (Export.dc.html): a soft card with an icon, a label, and an optional note on
 * the right.
 *
 * It lives in its own module because MobileExportSheet and ShareDestinations
 * both draw these rows and they have to match, and because the eslint config
 * enforces react-refresh/only-export-components, so a component file cannot
 * export a shared constant.
 */

export const SHARE_ROW = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    padding: '15px 16px',
    borderRadius: 15,
    background: 'var(--glass)',
    border: '1px solid var(--line)',
    color: 'var(--fg)',
    minHeight: 44,
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'var(--f-sans)',
};

/** The label inside a row. */
export const SHARE_ROW_LABEL = { flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: 500 };

/** The quiet note on the right of a row (a format, a status). */
export const SHARE_ROW_NOTE = { fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)', flex: 'none' };

/** A section heading, such as SEND IT TO. */
export const SHARE_LABEL = {
    display: 'block',
    fontFamily: 'var(--f-mono)',
    fontSize: 11.5,
    letterSpacing: '0.14em',
    color: 'var(--fg-3)',
    marginBottom: 12,
};

export default { SHARE_ROW, SHARE_ROW_LABEL, SHARE_ROW_NOTE, SHARE_LABEL };
