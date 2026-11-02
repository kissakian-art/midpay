-- Read-only checks to run BEFORE applying migration 0011 to an existing DB.
-- These SELECTs never delete or rewrite financial history. Empty results are
-- expected. Resolve duplicate/partial legacy operations against provider data.
SELECT buyer_id, content_id, count(*) AS duplicate_count
FROM transactions WHERE payment_status IN ('pending', 'paid') AND content_id IS NOT NULL
GROUP BY buyer_id, content_id HAVING count(*) > 1;

SELECT buyer_id, live_event_id, count(*) AS duplicate_count
FROM transactions WHERE payment_status IN ('pending', 'paid') AND live_event_id IS NOT NULL
GROUP BY buyer_id, live_event_id HAVING count(*) > 1;

SELECT flutterwave_flw_id, count(*) AS duplicate_count
FROM transactions WHERE flutterwave_flw_id IS NOT NULL
GROUP BY flutterwave_flw_id HAVING count(*) > 1;

SELECT transaction_id, count(*) AS duplicate_count
FROM wallet_entries WHERE type = 'sale_credit' AND transaction_id IS NOT NULL
GROUP BY transaction_id HAVING count(*) > 1;

SELECT payout_id, count(*) AS duplicate_count
FROM wallet_entries WHERE type = 'hold' AND payout_id IS NOT NULL
GROUP BY payout_id HAVING count(*) > 1;

SELECT payout_id, count(*) AS duplicate_count
FROM wallet_entries WHERE type IN ('release', 'payout_debit') AND payout_id IS NOT NULL
GROUP BY payout_id HAVING count(*) > 1;

SELECT t.id AS incomplete_paid_transaction
FROM transactions t
WHERE t.payment_status = 'paid' AND
  (NOT EXISTS (SELECT 1 FROM entitlements e WHERE e.transaction_id = t.id)
   OR NOT EXISTS (SELECT 1 FROM wallet_entries e WHERE e.transaction_id = t.id AND e.type = 'sale_credit'));

SELECT id, balance_ugx, held_ugx FROM wallets WHERE balance_ugx < 0 OR held_ugx < 0;

SELECT p.id AS payout_missing_hold
FROM payouts p WHERE NOT EXISTS
  (SELECT 1 FROM wallet_entries e WHERE e.payout_id = p.id AND e.type = 'hold');

SELECT w.id, w.held_ugx, coalesce(sum(p.gross_ugx), 0) AS reserved_payouts
FROM wallets w LEFT JOIN payouts p ON p.wallet_id = w.id AND p.status IN ('pending', 'held')
GROUP BY w.id HAVING w.held_ugx <> coalesce(sum(p.gross_ugx), 0);

-- payout_debit consumes HELD funds; hold/release move the AVAILABLE balance.
SELECT w.id, w.balance_ugx, coalesce(sum(CASE WHEN e.type <> 'payout_debit' THEN e.amount_ugx ELSE 0 END), 0) AS journal_available
FROM wallets w LEFT JOIN wallet_entries e ON e.wallet_id = w.id
GROUP BY w.id HAVING w.balance_ugx <> coalesce(sum(CASE WHEN e.type <> 'payout_debit' THEN e.amount_ugx ELSE 0 END), 0);
