// Milestone 6: budgets and traces. The fake model's calls cost at most 15 cents each, and 1 cent per
// 100 tokens of usage. The traces are made up, priced at GPT-6 Luna's rates.

import assert from "node:assert/strict";
import { test } from "node:test";
import { callWithBudget, createBudget, reserve, settle } from "../src/budget.mjs";
import { fakeModel } from "../src/lib/fake-model.mjs";
import { traceTotals } from "../src/trace.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

const trial = { id: "chen.wei@example.com", plan: "trial" }; // 50 cents a day
const subscriber = { id: "pia.lund@example.com", plan: "subscriber" }; // no per-user limit
const request = { messages: [{ role: "user", content: "Where is order 1042?" }], max_completion_tokens: 400 };
const complete = { status: "complete", text: "Order 1042 was delivered on October 2.", usage: { input: 1000, output: 300 } }; // 13 cents

// "the subscriber's spend is 15 cents", or "the subscriber has no spend recorded", for a message.
const spend = (budget, user, who) => (budget.users.get(user.id) === undefined ? `${who} has no spend recorded` : `${who}'s spend is ${show(budget.users.get(user.id))} cents`);
// A reason of the learner's choice: any text that isn't empty.
const isReason = (reason) => typeof reason === "string" && reason.trim() !== "";

test("reserves against the user's plan limit, then the global limit", () => {
  const budget = createBudget({ globalCents: 100 });
  const first = [reserve(budget, trial, 15), reserve(budget, trial, 15)];
  assert.ok(first.every((r) => r?.ok && r.id), `reserve returned ${show(first)} for two 15-cent reservations against a trial's 50 cents. Both fit: each should return { ok: true, id }.`);
  assert.notEqual(first[0].id, first[1].id, `Two reservations got the same id, ${show(first[0].id)}. Each one needs its own, so settle can find it.`);
  const over = reserve(budget, trial, 25);
  assert.deepEqual(over, { ok: false, reason: "user limit" }, `reserve returned ${show(over)} for 25 more cents, while the first 30 were still pending. 55 would go over 50: { ok: false, reason: 'user limit' }.`);
  const exact = reserve(budget, trial, 20);
  assert.ok(exact?.ok, `reserve returned ${show(exact)} for 20 more cents, which fill the trial's 50 exactly. It fits.`);

  const big = reserve(budget, subscriber, 40);
  assert.ok(big?.ok, `reserve returned ${show(big)} for a subscriber's 40 cents, with 50 of the global 100 reserved. It fits: a subscriber has no per-user limit.`);
  const pastGlobal = reserve(budget, subscriber, 15);
  assert.deepEqual(
    pastGlobal,
    { ok: false, reason: "global limit" },
    `reserve returned ${show(pastGlobal)} for a subscriber's 15 more cents, with 90 of the global 100 reserved. Everyone shares the global limit: { ok: false, reason: 'global limit' }.`,
  );
  const fillsGlobal = reserve(budget, subscriber, 10);
  assert.ok(fillsGlobal?.ok, `reserve returned ${show(fillsGlobal)} for a subscriber's 10 cents, which fill the global 100 exactly. It fits.`);
  const both = reserve(budget, trial, 5);
  assert.deepEqual(both, { ok: false, reason: "user limit" }, `reserve returned ${show(both)} for 5 more of the trial's cents, which go over both limits. Check the user's limit first: { ok: false, reason: 'user limit' }.`);
  assert.deepEqual(
    [budget.users.get(trial.id), budget.users.get(subscriber.id), budget.total],
    [50, 50, 100],
    `After the failed reservations, budget.users holds ${show(budget.users.get(trial.id))} cents for the trial user and ${show(budget.users.get(subscriber.id))} for the subscriber, and budget.total is ${show(budget.total)}. A failed reservation records nothing: 50, 50, and 100.`,
  );
});

test("lets only the calls that fit reach the model when three arrive at once", async () => {
  const budget = createBudget();
  const r = reserve(budget, trial, 20);
  settle(budget, r?.id, 20); // 20 of the trial's 50 cents spent today
  const model = fakeModel({ replies: Array(6).fill(complete) });
  const results = await Promise.all([1, 2, 3].map(() => callWithBudget(budget, trial, request, model)));
  const reached = model.requests.length;
  assert.equal(
    reached,
    2,
    reached < 2
      ? `${reached} of 3 calls sent at once reached the model, with 20 of 50 cents spent and up to 15 cents a call. Only 2 fit: 20 + 15 + 15 fills the 50 exactly, and filling the limit is still within it.`
      : `${reached} of 3 calls sent at once reached the model, with 20 of 50 cents spent and up to 15 cents a call. Reserve before the call, in the same step as the check: only 2 fit.`,
  );
  const statuses = results.map((result) => result?.status);
  assert.deepEqual(
    statuses.sort(),
    ["complete", "complete", "over_budget"],
    `callWithBudget's results had the statuses ${show(statuses)}. The call that doesn't fit should return { status: 'over_budget', text: null, usage: null, reason: 'user limit' }.`,
  );
  assert.equal(budget.users.get(trial.id), 46, `After the calls, ${spend(budget, trial, "the trial user")}. Settle each call to its usage, 13 cents: 20 + 13 + 13 = 46.`);
});

test("settles to the usage, or keeps the reservation when usage never arrives", () => {
  const budget = createBudget();
  const ids = [15, 15, 15].map((cents) => reserve(budget, subscriber, cents)?.id);
  const charged = [settle(budget, ids[0], 9), settle(budget, ids[1], null), settle(budget, ids[2], 0)];
  const expected = [
    { ok: true, charged: 9 },
    { ok: true, charged: 15 },
    { ok: true, charged: 0 },
  ];
  const why =
    charged[2]?.charged === 15
      ? "A real 0 charges 0: only missing usage, null, keeps the reservation."
      : "The provider may have billed a call without usage, so null keeps the reservation as the charge.";
  assert.deepEqual(charged, expected, `settle returned ${show(charged)} for usage of 9 cents, missing usage (null), and a real 0. ${why} It should return ${show(expected)}.`);
  assert.equal(budget.users.get(subscriber.id), 24, `After those settles, ${spend(budget, subscriber, "the subscriber")}. It should be 9 + 15 + 0 = 24 cents.`);
  assert.equal(budget.total, 24, `budget.total is ${show(budget.total)} cents after those settles. It should be 24 too.`);
});

test("charges nothing more for a settle sent twice", () => {
  const budget = createBudget();
  const { id } = reserve(budget, trial, 15) ?? {};
  settle(budget, id, 9);
  const again = settle(budget, id, 9);
  assert.ok(again?.ok === false && isReason(again.reason), `settle returned ${show(again)} for a reservation it already settled. It should return { ok: false, reason }, with a reason you choose.`);
  assert.equal(budget.users.get(trial.id), 9, `After the same settle twice, ${spend(budget, trial, "the trial user")}. It should stay 9 cents.`);
  assert.equal(budget.total, 9, `budget.total is ${show(budget.total)} cents after the same settle twice. It should stay 9.`);
  const never = settle(budget, "r-404", 5);
  assert.ok(never?.ok === false && isReason(never.reason), `settle returned ${show(never)} for an id reserve never returned. It should return { ok: false, reason }, with a reason you choose.`);
  assert.equal(budget.total, 9, `budget.total is ${show(budget.total)} cents after a settle of an id reserve never returned. It should stay 9.`);
});

test("makes no call over the budget, and charges a call without usage its reservation", async () => {
  const budget = createBudget();
  reserve(budget, trial, 40); // a call of the trial user's is still running
  const model = fakeModel({ replies: [complete] });
  const over = await callWithBudget(budget, trial, request, model);
  const expected = { status: "over_budget", text: null, usage: null, reason: "user limit" };
  assert.deepEqual(over, expected, `callWithBudget returned ${show(over)} for a 15-cent call, with 40 of the trial's 50 cents reserved. It should return ${show(expected)}, the reservation's reason.`);
  assert.equal(model.requests.length, 0, `The model got ${model.requests.length} request(s) for a call that didn't fit the budget. It should get none.`);

  const broken = { status: "cut_off", text: "Order 2006 left our warehouse on", usage: null }; // its usage never arrived
  const result = await callWithBudget(budget, subscriber, request, fakeModel({ replies: [broken] }));
  assert.deepEqual(result, broken, `callWithBudget returned ${show(result)}. It should return the model's result as it came: ${show(broken)}.`);
  assert.equal(
    budget.users.get(subscriber.id),
    15,
    `After a call whose usage never arrived, ${spend(budget, subscriber, "the subscriber")}. The provider may have billed it, so it keeps its 15-cent reservation.`,
  );
});

test("settles a failed call to its reservation, and passes its error on", async () => {
  // The new case: the provider took too long, the client gave up, and model.complete threw.
  const budget = createBudget();
  const timeout = new Error("The operation was aborted due to timeout");
  let thrown;
  try {
    await callWithBudget(budget, subscriber, request, fakeModel({ replies: [timeout] }));
  } catch (error) {
    rethrowNotBuilt(error);
    thrown = error;
  }
  assert.equal(thrown, timeout, `callWithBudget ${thrown ? `threw ${show(thrown?.message ?? thrown)}` : "resolved"} when model.complete threw "${timeout.message}". It should throw that same error, so the caller knows the call failed.`);
  assert.deepEqual(
    [budget.users.get(subscriber.id), budget.total],
    [15, 15],
    `After a call that threw, ${spend(budget, subscriber, "the subscriber")}, and budget.total is ${show(budget.total)} cents. The request may have reached the provider, and the reservation is the most it can cost: both should be 15.`,
  );
  assert.equal(
    budget.reservations.size,
    0,
    "After a call that threw, its reservation is still pending in budget.reservations. Settle it on the error path too, with null, so it's charged once and not left open.",
  );
});

test("keeps a trace's cost from usage apart from its estimated cost", () => {
  // The route call, then the answer's stream breaks before its usage arrives, and the retry answers.
  const spans = [
    { name: "model", step: "route", input: 900, maxOutput: 100, usage: { input: 900, output: 12 }, status: "complete", ms: 410 },
    { name: "embed", ms: 120 },
    { name: "retrieve", chunks: 5, ms: 38 },
    { name: "model", step: "answer", input: 4200, maxOutput: 400, usage: null, status: "interrupted", ms: 5200 },
    { name: "model", step: "answer", input: 4200, maxOutput: 400, usage: { input: 4200, cached: 3584, written: 0, output: 150 }, status: "complete", ms: 1700 },
  ];
  const totals = traceTotals(spans);
  const rounded = { fromUsage: totals?.fromUsage?.toFixed?.(6), estimated: totals?.estimated?.toFixed?.(6) };
  assert.deepEqual(
    rounded,
    { fromUsage: "0.000268", estimated: "0.000725" },
    `traceTotals returned ${show(totals)}. Price the spans with usage by usageUsd, and the one without by estimatedUsd, in two sums: from usage 0.000268, estimated 0.000725.`,
  );
});

test("counts only model spans, so a trace without them costs nothing", () => {
  const spans = [
    { name: "budget", step: "route", outcome: "user limit" },
    { name: "retrieve", chunks: 4, ms: 40 },
    { name: "tool get_order", outcome: "ok", ms: 30 },
  ];
  for (const [label, trace] of [["a budget refusal, a retrieval, and a tool call", spans], ["no spans", []]]) {
    const totals = traceTotals(trace);
    assert.deepEqual(totals, { fromUsage: 0, estimated: 0 }, `traceTotals returned ${show(totals)} for ${label}. Only model calls cost money here: { fromUsage: 0, estimated: 0 }.`);
  }
});
