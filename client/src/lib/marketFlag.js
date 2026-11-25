/**
 * client/src/lib/marketFlag.js — VIBED Market on/off switch (R102).
 *
 * The market is hidden until it runs on real data. Off by default: no route,
 * no nav entry, no copy mentions it. Set VITE_MARKET_ENABLED=true at build
 * time (and MARKET_ENABLED=true on the API) to bring it back.
 */
export const MARKET_ENABLED = import.meta.env.VITE_MARKET_ENABLED === 'true';
