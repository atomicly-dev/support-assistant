// Milestone 5: refunds. See milestones/5-refunds.md.
//
// The model proposes, your code executes. proposeRefund is the model's only refund tool, approve is
// a support agent's approval of one proposal, and executeRefund pays exactly what was approved.

import { randomUUID } from "node:crypto";

// An approval works for 15 minutes.
export const APPROVAL_MS = 15 * 60_000;

// The tool as the model sees it. It stores a proposal and pays nothing.
export const PROPOSE_REFUND_TOOL = {
  type: "function",
  function: {
    name: "propose_refund",
    description: "Propose a refund of one of the customer's own orders, in cents. A support agent reviews it before anything is paid.",
    strict: true,
    parameters: {
      type: "object",
      properties: { orderId: { type: "integer" }, amountCents: { type: "integer" } },
      required: ["orderId", "amountCents"],
      additionalProperties: false,
    },
  },
};

/**
 * The propose_refund tool. `args` come from the model, `session` from the customer's login:
 * { tenantId, email }. `desk` comes from createDesk() in src/lib/desk.mjs.
 * Resolves to { proposalId, status: "awaiting approval" }, or to { error } for an order that isn't
 * the session customer's, or an amount that isn't a whole number of cents from 1 to the order's total.
 */
export async function proposeRefund(args, session, desk) {
  throw new Error("Not built yet: milestone 5");
}

/**
 * A support agent approves one proposal. `agent` comes from the agent's login: { actorId }, and
 * `now` is the time in milliseconds.
 * Stores the approval in desk.approvals and returns { approvalId, args, actorId, expiresAt,
 * idempotencyKey }, or { error: "no such proposal" }.
 */
export function approve(proposalId, agent, now, desk) {
  throw new Error("Not built yet: milestone 5");
}

/**
 * Pays an approved refund. `command` is { approvalId, args: { orderId, amountCents } }, `agent`
 * comes from the login of the agent who runs it, and `now` is the time in milliseconds.
 * Resolves to the ledger's refund, { refundId, orderId, amountCents }, or to { error }.
 */
export async function executeRefund(command, agent, now, desk) {
  throw new Error("Not built yet: milestone 5");
}
