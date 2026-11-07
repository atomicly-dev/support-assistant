// Milestone 5: refunds. The orders are the dataset's, from data/orders.json: Chen Wei's order 1042
// at Kettle & Co cost $129.00. Maya and Tom are support agents. The proposals are made up.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDesk } from "../src/lib/desk.mjs";
import { orderLookup } from "../src/lib/orders.mjs";
import { approve, executeRefund, proposeRefund } from "../src/refunds.mjs";
import { show } from "./helpers.mjs";

const chen = { tenantId: "kettleandco", email: "chen.wei@example.com" };
const maya = { actorId: "agent-maya" };
const tom = { actorId: "agent-tom" };
const NOW = Date.UTC(2026, 10, 5, 9, 0);
const MINUTE = 60_000;

// A desk with one approved proposal: $40.00 for order 1042, approved by Maya at NOW.
async function approvedRefund() {
  const desk = createDesk(orderLookup());
  const proposal = await proposeRefund({ orderId: 1042, amountCents: 4000 }, chen, desk);
  const approval = approve(proposal.proposalId, maya, NOW, desk);
  return { desk, approval };
}

test("stores a proposal and pays nothing", async () => {
  const desk = createDesk(orderLookup());
  const proposal = await proposeRefund({ orderId: 1042, amountCents: 4000 }, chen, desk);
  assert.equal(
    proposal?.status,
    "awaiting approval",
    `proposeRefund returned ${show(proposal)} for $40.00 on Chen's order 1042. It should store a proposal and return { proposalId, status: 'awaiting approval' }.`,
  );
  const stored = desk.proposals.get(proposal.proposalId);
  assert.deepEqual(stored, { orderId: 1042, amountCents: 4000 }, `desk.proposals holds ${show(stored)} under ${show(proposal.proposalId)}. It should hold the proposal's arguments, { orderId: 1042, amountCents: 4000 }.`);
  assert.equal(desk.ledger.refunds.size, 0, `The ledger paid ${desk.ledger.refunds.size} refund(s) after a proposal. The model only proposes: nothing is paid until an agent approves it.`);
});

test("binds the approval to the proposal's exact arguments, the agent, an expiry, and a key", async () => {
  const { desk, approval } = await approvedRefund();
  assert.deepEqual(approval?.args, { orderId: 1042, amountCents: 4000 }, `approve returned ${show(approval)}. Its args should be the proposal's exact arguments, { orderId: 1042, amountCents: 4000 }.`);
  assert.equal(approval.actorId, "agent-maya", `The approval's actorId is ${show(approval.actorId)}. It should come from the agent's login: "agent-maya".`);
  assert.equal(approval.expiresAt, NOW + 15 * MINUTE, `The approval expires at ${show(approval.expiresAt)}. It should expire 15 minutes after now: ${NOW + 15 * MINUTE}.`);
  const second = approve((await proposeRefund({ orderId: 1042, amountCents: 1500 }, chen, desk)).proposalId, maya, NOW, desk);
  assert.ok(
    typeof approval.idempotencyKey === "string" && approval.idempotencyKey.length >= 16 && approval.idempotencyKey !== second?.idempotencyKey,
    `Two approvals got the idempotency keys ${show(approval.idempotencyKey)} and ${show(second?.idempotencyKey)}. Each approval needs its own random key, such as randomUUID().`,
  );
  assert.deepEqual(desk.approvals.get(approval.approvalId)?.args, approval.args, `desk.approvals has no approval under ${show(approval.approvalId)}. Store it, so executeRefund can find it.`);
});

test("refuses to pay an amount the approval didn't cover", async () => {
  const { desk, approval } = await approvedRefund();
  const result = await executeRefund({ approvalId: approval.approvalId, args: { orderId: 1042, amountCents: 40000 } }, maya, NOW + MINUTE, desk);
  assert.deepEqual(
    result,
    { error: "arguments differ from the approval" },
    `executeRefund returned ${show(result)} for $400.00 against Maya's approval of $40.00. It should refuse: { error: 'arguments differ from the approval' }.`,
  );
  assert.equal(desk.ledger.refunds.size, 0, `The ledger paid ${show([...desk.ledger.refunds.values()])}. It should pay nothing for a changed amount.`);
});

test("refuses an approval used by another agent or after it expires", async () => {
  const { desk, approval } = await approvedRefund();
  const args = { orderId: 1042, amountCents: 4000 };
  const byTom = await executeRefund({ approvalId: approval.approvalId, args, actorId: "agent-maya" }, tom, NOW + MINUTE, desk);
  assert.deepEqual(
    byTom,
    { error: "approved by another agent" },
    `executeRefund returned ${show(byTom)} when Tom ran Maya's approval, with Maya's id in the command. The actor comes from the login, never the command: { error: 'approved by another agent' }.`,
  );
  const late = await executeRefund({ approvalId: approval.approvalId, args }, maya, NOW + 15 * MINUTE, desk);
  assert.deepEqual(late, { error: "approval expired" }, `executeRefund returned ${show(late)} at the approval's expiry, 15 minutes after it. From expiresAt on, it should return { error: 'approval expired' }.`);
  assert.equal(desk.ledger.refunds.size, 0, `The ledger paid ${show([...desk.ledger.refunds.values()])}. It should pay nothing here.`);
});

test("pays a retried command once, whatever order its fields come in", async () => {
  const { desk, approval } = await approvedRefund();
  const first = await executeRefund({ approvalId: approval.approvalId, args: { orderId: 1042, amountCents: 4000 } }, maya, NOW + MINUTE, desk);
  const retry = await executeRefund({ approvalId: approval.approvalId, args: { amountCents: 4000, orderId: 1042 } }, maya, NOW + 2 * MINUTE, desk);
  const expected = { refundId: "rf_1", orderId: 1042, amountCents: 4000 };
  assert.deepEqual(first, expected, `executeRefund returned ${show(first)} for the approved command. It should pay it through desk.ledger.refund: ${show(expected)}.`);
  assert.deepEqual(
    retry,
    expected,
    `executeRefund returned ${show(retry)} for a retry that lists the amount first. Compare each field by name, and pay with the approval's idempotency key, so the ledger returns the first refund again: ${show(expected)}.`,
  );
  assert.equal(desk.ledger.refunds.size, 1, `The ledger paid ${desk.ledger.refunds.size} refunds for one approval. It should pay once.`);
});

test("fails every call of the replayed injection transcripts, and pays nothing", async () => {
  const { session, transcripts } = JSON.parse(readFileSync(new URL("fixtures/injection-replays.json", import.meta.url), "utf8"));
  // The model's only refund tool. Approving and paying aren't tools the model gets.
  const MODEL_TOOLS = new Map([["propose_refund", proposeRefund]]);
  for (const transcript of transcripts) {
    const desk = createDesk(orderLookup());
    for (const call of transcript.calls) {
      const tool = MODEL_TOOLS.get(call.name);
      const result = tool ? await tool(call.args, session, desk) : { error: `unknown tool: ${call.name}` };
      assert.ok(
        typeof result?.error === "string",
        `In the replay "${transcript.id}", ${call.name}(${show(call.args)}) returned ${show(result)}. Chen doesn't own that order, or can't get that amount, so the call should return { error }.`,
      );
    }
    assert.equal(desk.proposals.size, 0, `The replay "${transcript.id}" left the proposals ${show([...desk.proposals.values()])}. None of its calls should store one.`);
    assert.equal(desk.ledger.refunds.size, 0, `The replay "${transcript.id}" paid ${show([...desk.ledger.refunds.values()])}. It should pay nothing.`);
  }
});
