/**
 * Free-tier limits for the public web surface.
 *
 * Paid pricing has moved to `lib/payments/mppx.ts` (`MPPX_PRICING`).
 * Bundle top-ups (`TOPUP_BUNDLES`, `ACTION_COST_UNITS`) were removed in
 * audit fix #002.
 */

/** Anonymous preview — IP-scoped daily allowance before 402. */
export const ANON_CHAT_PER_DAY = 1;

/** Wallet free tier — daily, after a SIWS sign-in, before 402. */
export const WALLET_FREE_CHAT_PER_DAY = 10;

/** Wallet free tier — monthly scan allowance, before 402. */
export const WALLET_FREE_SCANS_PER_MONTH = 2;
