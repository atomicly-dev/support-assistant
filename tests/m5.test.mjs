// Milestone 5: refunds. The orders are the dataset's, from data/orders.json: Ana Silva's order 1040
// at Kettle & Co cost $89.00, and her order 1048 $56.00. Priya and Sam are support agents. The
// proposals are made up.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDesk } from "../src/lib/desk.mjs";
import { orderLookup } from "../src/lib/orders.mjs";
import { approve, executeRefund, proposeRefund } from "../src/refunds.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

const ana = { tenantId: "kettleandco", email: "ana.silva@example.com" };
const priya = { actorId: "agent-priya" };
const sam = { actorId: "agent-sam" };
const NOW = Date.UTC(2026, 10, 6, 14, 30);
const MINUTE = 60_000;
const toaster = { orderId: 1040, amountCents: 3500 }; // $35.00 of the $89.00 order

// A desk with one approved proposal: $35.00 for order 1040, approved by Priya at NOW.
async function approvedRefund() {
  const desk = createDesk(orderLookup());
  const proposal = await proposeRefund({ ...toaster }, ana, desk);
  const approval = approve(proposal?.proposalId, priya, NOW, desk);
  return { desk, approval };
}

async function execute(command, agent, now, desk) {
  try {
    return await executeRefund(command, agent, now, desk);
  } catch (error) {
    rethrowNotBuilt(error);
    return `an error: ${error.message}`;
  }
}
const paid = (desk) => [...desk.ledger.refunds.values()];

test("stores a proposal and pays nothing", async () => {
  const desk = createDesk(orderLookup());
  const proposal = await proposeRefund({ ...toaster }, ana, desk);
  assert.equal(
    proposal?.status,
    "awaiting approval",
    `proposeRefund returned ${show(proposal)} for $35.00 on Ana's order 1040. It should store a proposal and return { proposalId, status: 'awaiting approval' }.`,
  );
  const stored = desk.proposals.get(proposal.proposalId);
  assert.deepEqual(stored, toaster, `desk.proposals holds ${show(stored)} under ${show(proposal.proposalId)}. It should hold the proposal's arguments, ${show(toaster)}.`);
  assert.equal(desk.ledger.refunds.size, 0, `The ledger paid ${desk.ledger.refunds.size} refund(s) after a proposal. The model only proposes: nothing is paid until an agent approves it.`);
});

test("proposes only the customer's own order, for 1 cent up to its total", async () => {
  const desk = createDesk(orderLookup());
  const notFound = [
    ["order 1042, Chen's", { orderId: 1042, amountCents: 3500 }, ana],
    ["order 2002, a Deskworks customer's", { orderId: 2002, amountCents: 3500 }, ana],
    ["order 1040, from a Deskworks session with Ana's email", { ...toaster }, { tenantId: "deskworks", email: ana.email }],
    ["order 9999, which doesn't exist", { orderId: 9999, amountCents: 3500 }, ana],
  ];
  for (const [label, args, session] of notFound) {
    const result = await proposeRefund(args, session, desk);
    assert.deepEqual(
      result,
      { error: "order not found" },
      `proposeRefund returned ${show(result)} for ${label}. Only the session customer's own order in the session's shop can get a proposal, and every other order gets { error: 'order not found' }.`,
    );
  }
  for (const amountCents of [0, -8900, 35.5, "3500", 8901]) {
    const result = await proposeRefund({ orderId: 1040, amountCents }, ana, desk);
    assert.ok(
      typeof result?.error === "string",
      `proposeRefund returned ${show(result)} for amountCents ${show(amountCents)} on order 1040, which cost 8900 cents. A refund is a whole number of cents from 1 to the order's total, so it should return { error }.`,
    );
  }
  assert.equal(desk.proposals.size, 0, `desk.proposals holds ${show([...desk.proposals.values()])}. None of those calls should store a proposal.`);
  for (const amountCents of [1, 8900]) {
    const result = await proposeRefund({ orderId: 1040, amountCents }, ana, desk);
    assert.equal(result?.status, "awaiting approval", `proposeRefund returned ${show(result)} for amountCents ${amountCents} on order 1040, which cost 8900 cents. Any amount from 1 cent up to the whole total fits.`);
  }
});

test("binds the approval to a copy of the proposal's arguments, the agent, an expiry, and a key", async () => {
  const { desk, approval } = await approvedRefund();
  assert.deepEqual(approval?.args, toaster, `approve returned ${show(approval)}. Its args should be the proposal's exact arguments, ${show(toaster)}.`);
  assert.equal(approval.actorId, "agent-priya", `The approval's actorId is ${show(approval.actorId)}. It should come from the agent's login: "agent-priya".`);
  assert.equal(approval.expiresAt, NOW + 15 * MINUTE, `The approval expires at ${show(approval.expiresAt)}. It should expire 15 minutes after now: ${NOW + 15 * MINUTE}.`);
  assert.deepEqual(desk.approvals.get(approval.approvalId)?.args, toaster, `desk.approvals holds ${show(desk.approvals.get(approval.approvalId))} under ${show(approval.approvalId)}. Store the approval, so executeRefund can find it.`);

  const again = await proposeRefund({ ...toaster }, ana, desk);
  const second = approve(again?.proposalId, priya, NOW, desk);
  assert.ok(
    typeof approval.idempotencyKey === "string" && approval.idempotencyKey !== "" && approval.idempotencyKey !== second?.idempotencyKey,
    `Two approvals of the same $35.00 on order 1040 got the idempotency keys ${show(approval.idempotencyKey)} and ${show(second?.idempotencyKey)}. Each approval needs its own random key, a string.`,
  );

  const proposal = desk.proposals.get(again.proposalId);
  if (proposal) proposal.amountCents = 8900; // a later change to the proposal, after Priya approved it
  assert.deepEqual(
    desk.approvals.get(second.approvalId)?.args,
    toaster,
    `After Priya approved $35.00, the proposal changed to $89.00, and the stored approval now holds ${show(desk.approvals.get(second.approvalId)?.args)}. An approval keeps its own copy of the arguments the agent saw: ${show(toaster)}.`,
  );
  const unknown = approve("p_99", priya, NOW, desk);
  assert.deepEqual(unknown, { error: "no such proposal" }, `approve returned ${show(unknown)} for p_99, a proposal that doesn't exist. It should return { error: 'no such proposal' }.`);
});

test("refuses to pay an order or an amount the approval didn't cover", async () => {
  const { desk, approval } = await approvedRefund();
  const changes = [
    ["the full $89.00 on order 1040", { orderId: 1040, amountCents: 8900 }],
    ["$35.00 on order 1048, Ana's other order", { orderId: 1048, amountCents: 3500 }],
  ];
  for (const [label, args] of changes) {
    const result = await execute({ approvalId: approval.approvalId, args }, priya, NOW + MINUTE, desk);
    assert.deepEqual(
      result,
      { error: "arguments differ from the approval" },
      `executeRefund returned ${show(result)} for ${label}, against Priya's approval of $35.00 on order 1040. It should refuse: { error: 'arguments differ from the approval' }.`,
    );
  }
  assert.equal(desk.ledger.refunds.size, 0, `The ledger paid ${show(paid(desk))}. It should pay nothing for a changed order or amount.`);
});

test("refuses an unknown approval, another agent's, or an expired one", async () => {
  const { desk, approval } = await approvedRefund();
  const args = { ...toaster };
  const unknown = await execute({ approvalId: "a_99", args }, priya, NOW + MINUTE, desk);
  assert.deepEqual(unknown, { error: "no such approval" }, `executeRefund returned ${show(unknown)} for a_99, an approval that doesn't exist. It should return { error: 'no such approval' }.`);
  const bySam = await execute({ approvalId: approval.approvalId, args, actorId: "agent-priya" }, sam, NOW + MINUTE, desk);
  assert.deepEqual(
    bySam,
    { error: "approved by another agent" },
    `executeRefund returned ${show(bySam)} when Sam ran Priya's approval, with Priya's id in the command. The agent comes from the login, never the command: { error: 'approved by another agent' }.`,
  );
  const late = await execute({ approvalId: approval.approvalId, args }, priya, NOW + 15 * MINUTE, desk);
  assert.deepEqual(late, { error: "approval expired" }, `executeRefund returned ${show(late)} at the approval's expiry, 15 minutes after Priya approved it. From expiresAt on, it should return { error: 'approval expired' }.`);
  assert.equal(desk.ledger.refunds.size, 0, `The ledger paid ${show(paid(desk))}. It should pay nothing here.`);
});

test("pays a retried command once, whatever order its fields come in", async () => {
  const { desk, approval } = await approvedRefund();
  const first = await execute({ approvalId: approval.approvalId, args: { orderId: 1040, amountCents: 3500 } }, priya, NOW + MINUTE, desk);
  const retry = await execute({ approvalId: approval.approvalId, args: { amountCents: 3500, orderId: 1040 } }, priya, NOW + 2 * MINUTE, desk);
  const expected = { refundId: "rf_1", orderId: 1040, amountCents: 3500 };
  assert.deepEqual(first, expected, `executeRefund returned ${show(first)} for the approved command. It should pay it through desk.ledger.refund: ${show(expected)}.`);
  assert.deepEqual(
    retry,
    expected,
    `executeRefund returned ${show(retry)} for a retry that lists the amount first. Compare each field by name, and pay with the approval's idempotency key, so the ledger returns the first refund again: ${show(expected)}.`,
  );
  assert.equal(desk.ledger.refunds.size, 1, `The ledger paid ${desk.ledger.refunds.size} refunds for one approval. It should pay once.`);
});

test("approves each proposal once, so a double approval can't pay twice", async () => {
  // The new case: Priya's click on "Approve" went through twice, and Sam approved the same proposal.
  const desk = createDesk(orderLookup());
  const proposal = await proposeRefund({ ...toaster }, ana, desk);
  const approvals = [approve(proposal?.proposalId, priya, NOW, desk), approve(proposal?.proposalId, priya, NOW + 1000, desk), approve(proposal?.proposalId, sam, NOW + 2000, desk)];
  assert.ok(approvals[0]?.approvalId, `approve returned ${show(approvals[0])} for the first approval of ${proposal?.proposalId}. It should approve it.`);
  for (const [i, who] of [[1, "Priya's second click"], [2, "Sam's approval after Priya's"]]) {
    const refused = approvals[i];
    assert.ok(
      typeof refused?.error === "string" && refused.error.trim() !== "" && Object.keys(refused).length === 1,
      `approve returned ${show(refused)} for ${who}, on a proposal Priya already approved. Each approval gets its own idempotency key, so the ledger gets a key it hasn't paid with yet, and pays again. One proposal gets one approval: it should return { error }, with any message you like.`,
    );
  }
  for (const [approval, agent] of [[approvals[0], priya], [approvals[1], priya], [approvals[2], sam]]) {
    if (approval?.approvalId) await execute({ approvalId: approval.approvalId, args: { ...toaster } }, agent, NOW + MINUTE, desk);
  }
  assert.deepEqual(paid(desk), [{ refundId: "rf_1", ...toaster }], `The ledger paid ${show(paid(desk))} for one proposal. It should pay it once.`);
  const other = await proposeRefund({ orderId: 1048, amountCents: 1200 }, ana, desk);
  assert.ok(approve(other?.proposalId, sam, NOW, desk)?.approvalId, `approve refused ${other?.proposalId}, a proposal nobody approved yet. Refuse only a second approval of the same proposal.`);
});

test("fails every call in the replayed injection transcripts, and pays nothing", async () => {
  const { session, transcripts } = JSON.parse(readFileSync(new URL("fixtures/injection-replays.json", import.meta.url), "utf8"));
  const findOrder = orderLookup();
  // Why a call has to fail, for the failure message.
  async function why(call) {
    const { orderId, amountCents } = call.args;
    const order = await findOrder(orderId);
    if (!order) return `order ${orderId} doesn't exist`;
    if (order.tenantId !== session.tenantId) return `order ${orderId} is another shop's`;
    if (order.email !== session.email) return `order ${orderId} is another customer's`;
    if (Number.isInteger(amountCents) && amountCents > order.totalCents) return `${amountCents} cents is more than order ${orderId}'s total, ${order.totalCents} cents`;
    return `${show(amountCents)} isn't a whole number of cents from 1 to order ${orderId}'s total, ${order.totalCents}`;
  }
  // The model's only refund tool. Approving and paying aren't tools the model gets.
  const MODEL_TOOLS = new Map([["propose_refund", proposeRefund]]);
  for (const transcript of transcripts) {
    const desk = createDesk(findOrder);
    for (const call of transcript.calls) {
      const tool = MODEL_TOOLS.get(call.name);
      const result = tool ? await tool(call.args, session, desk) : { error: `unknown tool: ${call.name}` };
      assert.ok(
        typeof result?.error === "string",
        `In the replay "${transcript.id}", ${call.name}(${show(call.args)}) returned ${show(result)}. In Chen's session, ${await why(call)}, so the call should return { error }.`,
      );
    }
    assert.equal(desk.proposals.size, 0, `The replay "${transcript.id}" left the proposals ${show([...desk.proposals.values()])}. None of its calls should store one.`);
    assert.equal(desk.ledger.refunds.size, 0, `The replay "${transcript.id}" paid ${show(paid(desk))}. It should pay nothing.`);
  }
});
