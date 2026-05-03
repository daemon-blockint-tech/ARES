/**
 * Read-only credit ledger helpers.
 *
 * Write paths (`insertDebitPending`, `settleDebit`, `refundDebit`) were
 * removed in audit fix #004 — payments are now settled inline by mppx
 * before the route handler runs, so there is no pending-debit state.
 *
 * The dashboard `/dashboard/billing` and `/api/auth/me` still surface a
 * historical balance and ledger view for wallets that earned credits via
 * the legacy bundle flow. Future entries can be added by an admin tool
 * (manual grants, support credits) but are not generated automatically.
 */
import type pg from "pg";

export async function upsertWalletFree(pool: pg.Pool, address: string): Promise<void> {
  await pool.query(
    `INSERT INTO wallets (address, tier) VALUES ($1, 'free')
     ON CONFLICT (address) DO NOTHING`,
    [address],
  );
}

export async function getBalanceUnits(pool: pg.Pool, wallet: string): Promise<number> {
  const r = await pool.query<{ bal: string }>(
    `SELECT COALESCE(SUM(CASE
          WHEN direction = 'CREDIT' AND status = 'SETTLED' THEN units
          WHEN direction = 'DEBIT' AND status = 'SETTLED' THEN -units
          ELSE 0 END), 0)::TEXT AS bal
       FROM credits_ledger WHERE wallet = $1`,
    [wallet],
  );
  const row = r.rows[0];
  return row?.bal ? Number.parseInt(row.bal, 10) : 0;
}

export async function ledgerHistory(
  pool: pg.Pool,
  wallet: string,
  limit: number,
): Promise<
  {
    id: string;
    direction: string;
    units: string;
    reason: string;
    status: string;
    created_at: Date;
    related_tx_sig: string | null;
    related_run_id: string | null;
  }[]
> {
  const r = await pool.query(
    `SELECT id, direction, units::TEXT, reason, status, created_at, related_tx_sig, related_run_id
     FROM credits_ledger WHERE wallet = $1 ORDER BY id DESC LIMIT $2`,
    [wallet, limit],
  );
  return r.rows as {
    id: string;
    direction: string;
    units: string;
    reason: string;
    status: string;
    created_at: Date;
    related_tx_sig: string | null;
    related_run_id: string | null;
  }[];
}
