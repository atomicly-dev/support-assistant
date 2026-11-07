// Milestone 6: traces. See milestones/6-budgets-and-traces.md.
//
// A trace records one request as spans, one per step, such as
//   { name: "retrieve", chunks: 5, ms: 42 }
//   { name: "model", step: "answer", input: 3100, maxOutput: 512, usage: { input: 3100, output: 180 }, status: "complete", ms: 1900 }
//   { name: "tool get_order", outcome: "ok", ms: 35 }
// A model span's `input` is the most input tokens its request can count, and its usage is null
// when usage never arrived.

import { estimatedUsd, usageUsd } from "./lib/prices.mjs";

/**
 * Prices a trace's model spans in US dollars: from usage when it arrived, and from the call's
 * worst case, estimatedUsd({ input, maxOutput }), when it didn't. Other spans cost nothing.
 * Returns { fromUsage, estimated }, the two sums kept apart.
 */
export function traceTotals(spans) {
  throw new Error("Not built yet: milestone 6");
}
