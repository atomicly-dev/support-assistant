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
export async function proposeRefund({ orderId, amountCents }, session, desk) {
  const order = await desk.findOrder(orderId);
  if (!order || order.tenantId !== session.tenantId || order.email !== session.email) return { error: "order not found" };
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > order.totalCents) {
    return { error: `amountCents must be a whole number from 1 to ${order.totalCents}` };
  }
  const proposalId = `p_${desk.proposals.size + 1}`;
  desk.proposals.set(proposalId, { orderId, amountCents });
  return { proposalId, status: "awaiting approval" };
}

/**
 * A support agent approves one proposal. `agent` comes from the agent's login: { actorId }, and
 * `now` is the time in milliseconds.
 * Stores the approval in desk.approvals and returns { approvalId, args, actorId, expiresAt,
 * idempotencyKey }, or { error: "no such proposal" }.
 */
export function approve(proposalId, agent, now, desk) {
  const proposal = desk.proposals.get(proposalId);
  if (!proposal) return { error: "no such proposal" };
  // One proposal gets one approval: a second one would get its own key, and pay the refund again.
  for (const approval of desk.approvals.values()) if (approval.proposalId === proposalId) return { error: "already approved" };
  const approval = { proposalId, args: { ...proposal }, actorId: agent.actorId, expiresAt: now + APPROVAL_MS, idempotencyKey: randomUUID() };
  const approvalId = `a_${desk.approvals.size + 1}`;
  desk.approvals.set(approvalId, approval);
  return { approvalId, args: { ...approval.args }, actorId: approval.actorId, expiresAt: approval.expiresAt, idempotencyKey: approval.idempotencyKey };
}

/**
 * Pays an approved refund. `command` is { approvalId, args: { orderId, amountCents } }, `agent`
 * comes from the login of the agent who runs it, and `now` is the time in milliseconds.
 * Resolves to the ledger's refund, { refundId, orderId, amountCents }, or to { error }.
 */
export async function executeRefund(command, agent, now, desk) {
  const approval = desk.approvals.get(command.approvalId);
  if (!approval) return { error: "no such approval" };
  if (approval.actorId !== agent.actorId) return { error: "approved by another agent" };
  if (now >= approval.expiresAt) return { error: "approval expired" };
  if (command.args.orderId !== approval.args.orderId || command.args.amountCents !== approval.args.amountCents) {
    return { error: "arguments differ from the approval" };
  }
  return desk.ledger.refund({ idempotencyKey: approval.idempotencyKey, ...approval.args });
}
