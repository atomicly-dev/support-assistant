// The support desk's state for refunds: the proposals, the approvals, and a fake ledger that pays
// refunds. The tests and the `ask` command keep it in memory. You don't need to change this file.
//
// createDesk(findOrder) takes an async order lookup, such as orderLookup() from ./orders.mjs.

export function createDesk(findOrder) {
  const refunds = new Map(); // idempotency key → the refund paid with it
  return {
    findOrder,
    proposals: new Map(), // proposalId → { orderId, amountCents }
    approvals: new Map(), // approvalId → { args, actorId, expiresAt, idempotencyKey }
    ledger: {
      refunds,
      // Pays a refund once per key: a second call with the same key returns the first refund.
      async refund({ idempotencyKey, ...args }) {
        if (!refunds.has(idempotencyKey)) refunds.set(idempotencyKey, { refundId: `rf_${refunds.size + 1}`, ...args });
        return { ...refunds.get(idempotencyKey) };
      },
    },
  };
}
