# Milestone 6: Budgets and traces

Lessons: [Rate limiting by cost: budget the whole request](https://atomicly.dev/lessons/ai-service-budgets) and [Tracing: explain a slower, more expensive answer](https://atomicly.dev/lessons/ai-incident-traces)

## The situation

A trial user gets 50 cents of model calls a day. One of them, with 20 cents spent, sends three questions from three browser tabs at once. Each request checks the spend, calls the model, then records the cost, so all three pass the check before any of them records anything.

Then a deploy doubled the assistant's cost, and every request still returned `200`. The dashboard added up only the costs from usage, so the calls whose stream broke before the usage arrived cost nothing on it.

## What you build

**`reserve(budget, user, cents)`**, in `src/budget.mjs`, reserves one call's cost before the call, in the same step as the check. `budget` comes from `createBudget()`, `user` is `{ id, plan }`, and the plan's daily limit is in `budget.plans`, in cents, or `null` for no per-user limit. It returns `{ ok: true, id }` after it records the reservation in `budget.reservations`, `budget.users`, and `budget.total`, or:

- `{ ok: false, reason: "user limit" }` when the user's reserved and spent cents plus `cents` would pass the plan's limit
- `{ ok: false, reason: "global limit" }` when everyone's together would pass `budget.globalCents`

A failed reservation records nothing.

**`settle(budget, id, actualCents)`**, in `src/budget.mjs`, replaces a reservation with what the call really cost. With `actualCents` set to `null`, because the usage never arrived, it keeps the reservation as the charge: the provider may have billed the call, and the reservation is the most it can cost. A real `0` charges `0`. It returns `{ ok: true, charged }`, or `{ ok: false, reason: "no such reservation" }` for an id it already settled or never made, and charges nothing then.

**`callWithBudget(budget, user, request, model)`**, in `src/budget.mjs`, makes one `model.complete(request)` call within the budget:

1. Reserve `model.worstCaseCents(request)`. When it doesn't fit, resolve to `{ status: "over_budget", text: null, usage: null, reason }` with the reservation's reason, and make no call.
2. Call the model.
3. Settle to `model.costCents(result.usage)`, or to `null` when `result.usage` is missing. A call that throws keeps its reservation too, and the error goes on to the caller.

It resolves to the model's result.

**`traceTotals(spans)`**, in `src/trace.mjs`, prices a request's trace. A model span looks like `{ name: "model", step, input, maxOutput, usage, status, ms }`, where `input` is the most input tokens its request can count, and `usage` is `null` when it never arrived. It returns `{ fromUsage, estimated }` in US dollars, two sums kept apart:

- `fromUsage` adds `usageUsd(span.usage)` for the model spans with usage.
- `estimated` adds `estimatedUsd(span)` for the model spans without it: the call's worst case, as its reservation counted it.
- Spans that aren't `"model"`, such as retrieval and tools, cost nothing here. A trace without model spans gives `{ fromUsage: 0, estimated: 0 }`.

`usageUsd` and `estimatedUsd` are in `src/lib/prices.mjs`, with GPT-6 Luna's prices. `PLANS` and `createBudget` are already in `src/budget.mjs`.

## Run the checks

```sh
npm run milestone -- 6
```

The checks use the fake model from `src/lib/fake-model.mjs`: each call costs at most 15 cents, and 1 cent per 100 tokens of usage. They need no database:

- reserves against the user's plan limit, then the global limit
- lets only the calls that fit reach the model when three arrive at once
- settles to the usage, or keeps the reservation when usage never arrives
- charges nothing more for a settle sent twice
- keeps a trace's cost from usage apart from its estimated cost
- counts only model spans, so a trace without them costs nothing

The budget lives in memory, in one Node process. With several processes, keep the totals in PostgreSQL, and reserve with one `UPDATE` that checks the limit in its `WHERE`, as the end of section 3 in [Rate limiting by cost](https://atomicly.dev/lessons/ai-service-budgets) shows.

## Hints

- Section 2 of [Rate limiting by cost](https://atomicly.dev/lessons/ai-service-budgets), *Reserve before the call*, writes `reserve`, and section 3, *Settle from usage, or keep the reservation*, writes `settle`. Why does the concurrent check pass only if `reserve` runs before the `await`?
- Section 2 of [Tracing](https://atomicly.dev/lessons/ai-incident-traces), *Read the trace span by span*, writes `traceTotals` with the same two prices.

## The solution

The `solutions` branch has every milestone built. This one is in [`src/budget.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/budget.mjs) and [`src/trace.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/trace.mjs).
