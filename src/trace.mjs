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
 * Prices a trace's model calls in US dollars. Returns { fromUsage, estimated }, two sums kept apart:
 * the calls whose usage arrived, and the worst case of the calls whose usage didn't.
 */
export function traceTotals(spans) {
  const models = spans.filter((span) => span.name === "model");
  const sum = (list, price) => list.reduce((total, span) => total + price(span), 0);
  return {
    fromUsage: sum(models.filter((span) => span.usage), (span) => usageUsd(span.usage)),
    estimated: sum(models.filter((span) => !span.usage), estimatedUsd),
  };
}
