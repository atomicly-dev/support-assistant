// Milestone 6: budgets and traces. The fake model's calls cost at most 15 cents each, and 1 cent per
// 100 tokens of usage. The traces are made up, priced at GPT-6 Luna's rates.

import assert from "node:assert/strict";
import { test } from "node:test";
import { callWithBudget, createBudget, reserve, settle } from "../src/budget.mjs";
import { fakeModel } from "../src/lib/fake-model.mjs";
import { traceTotals } from "../src/trace.mjs";
import { show } from "./helpers.mjs";

const trial = { id: "chen.wei@example.com", plan: "trial" }; // 50 cents a day
const subscriber = { id: "pia.lund@example.com", plan: "subscriber" }; // no per-user limit
const request = { messages: [{ role: "user", content: "Where is order 1042?" }], max_completion_tokens: 400 };
const complete = { status: "complete", text: "Order 1042 was delivered on October 2.", usage: { input: 1000, output: 300 } }; // 13 cents

test("reserves against the user's plan limit, then the global limit", () => {
  const budget = createBudget({ globalCents: 100 });
  const first = [reserve(budget, trial, 20), reserve(budget, trial, 20)];
  assert.ok(first.every((r) => r?.ok), `reserve returned ${show(first)} for two 20-cent reservations against a trial's 50 cents. Both fit: each should return { ok: true, id }.`);
  const third = reserve(budget, trial, 20);
  assert.deepEqual(third, { ok: false, reason: "user limit" }, `reserve returned ${show(third)} for a third 20 cents, while the first two were still pending. 60 is over 50: { ok: false, reason: 'user limit' }.`);
  const exact = reserve(budget, trial, 10);
  assert.ok(exact?.ok, `reserve returned ${show(exact)} for 10 more cents, which fill the 50 exactly. It fits.`);
  const big = reserve(budget, subscriber, 60);
  assert.deepEqual(
    big,
    { ok: false, reason: "global limit" },
    `reserve returned ${show(big)} for a subscriber's 60 cents with 50 reserved of a global 100. A subscriber has no per-user limit, but everyone shares the global one: { ok: false, reason: 'global limit' }.`,
  );
  assert.equal(budget.users.get(trial.id), 50, `budget.users holds ${show(budget.users.get(trial.id))} cents for the trial user. A failed reservation reserves nothing: it should hold 50.`);
});

test("lets only the calls that fit reach the model when three arrive at once", async () => {
  const budget = createBudget();
  const r = reserve(budget, trial, 20);
  settle(budget, r.id, 20); // 20 of the trial's 50 cents spent today
  const model = fakeModel({ replies: Array(6).fill(complete) });
  const results = await Promise.all([1, 2, 3].map(() => callWithBudget(budget, trial, request, model)));
  assert.equal(
    model.requests.length,
    2,
    `${model.requests.length} of 3 calls sent at once reached the model, with 20 of 50 cents spent and up to 15 cents a call. Reserve before the call, in the same step as the check: only 2 fit.`,
  );
  const statuses = results.map((result) => result?.status);
  assert.deepEqual(
    statuses.sort(),
    ["complete", "complete", "over_budget"],
    `callWithBudget's results had the statuses ${show(statuses)}. The call that doesn't fit should return { status: 'over_budget', text: null, usage: null, reason: 'user limit' }.`,
  );
  assert.equal(budget.users.get(trial.id), 46, `After the calls, the trial user's spend is ${show(budget.users.get(trial.id))} cents. Settle each call to its usage, 13 cents: 20 + 13 + 13 = 46.`);
});

test("settles to the usage, or keeps the reservation when usage never arrives", () => {
  const budget = createBudget();
  const ids = [20, 20, 20].map((cents) => reserve(budget, subscriber, cents).id);
  const charged = [settle(budget, ids[0], 13), settle(budget, ids[1], null), settle(budget, ids[2], 0)];
  const expected = [
    { ok: true, charged: 13 },
    { ok: true, charged: 20 },
    { ok: true, charged: 0 },
  ];
  assert.deepEqual(
    charged,
    expected,
    `settle returned ${show(charged)} for usage of 13 cents, missing usage (null), and a real 0. The provider may have billed a call without usage, so it keeps the reservation: ${show(expected)}.`,
  );
  assert.equal(budget.users.get(subscriber.id), 33, `The user's spend is ${show(budget.users.get(subscriber.id))} cents after those settles. It should be 13 + 20 + 0 = 33.`);
});

test("charges nothing more for a settle sent twice", () => {
  const budget = createBudget();
  const { id } = reserve(budget, trial, 20);
  settle(budget, id, 13);
  const again = settle(budget, id, 13);
  assert.deepEqual(again, { ok: false, reason: "no such reservation" }, `settle returned ${show(again)} for a reservation it already settled. It should return { ok: false, reason: 'no such reservation' }.`);
  assert.equal(budget.users.get(trial.id), 13, `The trial user's spend is ${show(budget.users.get(trial.id))} cents after the same settle twice. It should stay 13.`);
  assert.equal(budget.total, 13, `budget.total is ${show(budget.total)} cents after the same settle twice. It should stay 13.`);
});

test("keeps a trace's cost from usage apart from its estimated cost", () => {
  // The model looks up the order, its answer's stream breaks before the usage arrives, and the retry answers.
  const spans = [
    { name: "retrieve", chunks: 5, ms: 42 },
    { name: "model", step: "lookup", input: 3100, maxOutput: 512, usage: { input: 3100, cached: 2048, written: 0, output: 40 }, ms: 900 },
    { name: "tool get_order", outcome: "ok", ms: 35 },
    { name: "model", step: "answer", input: 3300, maxOutput: 512, usage: null, ms: 5800 },
    { name: "model", step: "answer", input: 3300, maxOutput: 512, usage: { input: 3300, cached: 3072, written: 0, output: 180 }, ms: 1900 },
  ];
  const totals = traceTotals(spans);
  const rounded = { fromUsage: totals?.fromUsage?.toFixed(6), estimated: totals?.estimated?.toFixed(6) };
  assert.deepEqual(
    rounded,
    { fromUsage: "0.000289", estimated: "0.000669" },
    `traceTotals returned ${show(totals)}. Price the spans with usage by usageUsd, and the one without by estimatedUsd, in two sums: from usage 0.000289, estimated 0.000669.`,
  );
});

test("counts only model spans, so a trace without them costs nothing", () => {
  const spans = [
    { name: "retrieve", chunks: 4, ms: 40 },
    { name: "tool get_order", outcome: "ok", ms: 30 },
  ];
  for (const [label, trace] of [["a retrieval and a tool call", spans], ["no spans", []]]) {
    const totals = traceTotals(trace);
    assert.deepEqual(totals, { fromUsage: 0, estimated: 0 }, `traceTotals returned ${show(totals)} for ${label}. Retrieval and tools cost nothing here: { fromUsage: 0, estimated: 0 }.`);
  }
});
