# Milestone 6: Budgets and traces

Read this on atomicly, with the tutor next to it: [milestone 6 on atomicly](https://atomicly.dev/projects/proj-support-assistant/milestones/proj-support-m6).

Lessons: [Rate limiting by cost: budget the whole request](https://atomicly.dev/lessons/ai-service-budgets) and [Tracing: explain a slower, more expensive answer](https://atomicly.dev/lessons/ai-incident-traces)

## The situation

A trial user gets 50 cents of model calls a day. One of them, with 20 cents already spent, sends three questions at once from three browser tabs. Each request checks the spend, calls the model, then records the cost, so all three pass the check before any of them records anything. What has to happen in the same step as the check, so the third request's check counts the first two?

Then a deploy doubled the assistant's cost, and every request still returned `200`. The dashboard added up only the costs from usage, so a call whose stream broke before its usage arrived showed no cost.

## What you build

`reserve`, `settle`, and `callWithBudget` go in `src/budget.mjs`, next to `PLANS` and `createBudget`, which are already there. `traceTotals` goes in `src/trace.mjs`.

`budget` comes from `createBudget()`. It holds one day's budget, in cents:

- `plans`: each plan's `{ dailyCents }`, the most a user of that plan can spend in a day, or `null` for no per-user limit. `trial` gets 50, and `subscriber` gets `null`.
- `globalCents`: the most everyone together can spend in a day, 1000 by default
- `users`: an empty `Map` from a user's id to the cents they reserved or spent today
- `total`: the cents everyone reserved or spent today, `0` at first
- `reservations`: an empty `Map` for the pending reservations, by id. Store what `settle` needs, such as `{ userId, cents }`.
- `nextId`: a counter you can use for the ids, starting at `1`

`user` is `{ id, plan }`. `model` is a model client, fake or live:

- `model.complete(request)` resolves to a result, `{ status, text, usage }`, with `usage` as `{ input, output }`, or `null` when it never arrived. It can also throw.
- `model.worstCaseCents(request)` is the most the call can cost.
- `model.costCents(usage)` is what a call cost, from its usage.

**`reserve(budget, user, cents)`** reserves one call's cost before the call. It returns `{ ok: true, id }`, `{ ok: false, reason: "user limit" }`, or `{ ok: false, reason: "global limit" }`.

**`settle(budget, id, actualCents)`** replaces a reservation with what the call cost. `actualCents` is `null` when the usage never arrived. It returns `{ ok: true, charged }`. For an id that's already settled, or that `reserve` never returned, it returns `{ ok: false, reason }`, with any reason you like.

**`callWithBudget(budget, user, request, model)`** makes one `model.complete(request)` call within the budget. It resolves to the model's result, or to `{ status: "over_budget", text: null, usage: null, reason }`, with the reservation's reason.

**`traceTotals(spans)`** prices a request's trace in US dollars. A model span looks like `{ name: "model", step, input, maxOutput, usage, status, ms }`, where `input` is the most input tokens its request can count, and `usage` is `null` when it never arrived. Other spans have other names, such as `"retrieve"`, `"budget"`, or `"tool get_order"`. It returns `{ fromUsage, estimated }`:

- `fromUsage`: the model calls whose usage arrived, each priced with `usageUsd(span.usage)`
- `estimated`: the model calls whose usage didn't, each priced at its worst case with `estimatedUsd(span)`

`usageUsd` and `estimatedUsd` are in `src/lib/prices.mjs`, with GPT-6 Luna's prices.

## The rules

- A reservation fits when the user's reserved and spent cents, plus the new ones, stay within the plan's limit, and everyone's stay within the global limit. A reservation that fills a limit exactly still fits.
- The user's limit comes first, so a call that fits neither limit gets `"user limit"`.
- A failed reservation records nothing.
- When three calls arrive at once, only the calls that fit reach the model.
- `settle` charges the actual cost in place of the reservation. Missing usage, `null`, keeps the reservation as the charge, because the provider may have billed the call. A real `0` charges `0`.
- A second `settle` of the same id, or of an id `reserve` never returned, charges nothing.
- `callWithBudget` makes no call that doesn't fit. It charges every call it makes: the cost of its usage, or its reservation when the usage is missing.
- The two sums in `traceTotals` stay apart, and only model spans cost anything. A trace without model spans gives `{ fromUsage: 0, estimated: 0 }`.

The budget lives in memory, in one Node process. With several processes, keep the totals in PostgreSQL, as the end of section 3 of [Rate limiting by cost](https://atomicly.dev/lessons/ai-service-budgets) shows.

## The new case

The provider took too long, and the client gave up: `model.complete` threw a timeout error. The request may still have reached the provider, which can bill it. So `callWithBudget` charges the reservation with `settle(budget, id, null)`, and passes the error on to the caller. No reservation stays pending. The check "settles a failed call to its reservation, and passes its error on" tests it.

## Run the checks

```sh
npm run milestone -- 6
```

These checks use the fake model in `src/lib/fake-model.mjs`, where each call costs at most 15 cents, and 1 cent per 100 tokens of usage. They run without the database:

- reserves against the user's plan limit, then the global limit
- lets only the calls that fit reach the model when three arrive at once
- settles to the usage, or keeps the reservation when usage never arrives
- charges nothing more for a settle sent twice
- makes no call over the budget, and charges a call without usage its reservation
- settles a failed call to its reservation, and passes its error on
- keeps a trace's cost from usage apart from its estimated cost
- counts only model spans, so a trace without them costs nothing

## Hints

Stuck? The hints go from where the course teaches this, to the approach, to a detail people often get wrong.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Rate limiting by cost](https://atomicly.dev/lessons/ai-service-budgets): section 2, *Reserve before the call*, and section 3, *Settle from usage, or keep the reservation*.
- [Tracing](https://atomicly.dev/lessons/ai-incident-traces): section 2, *Read the trace span by span*.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `reserve`: check both limits and record the reservation in the same step, with no `await` in between.
- `settle`: find the reservation and remove it, then adjust the user's spend and the total by the difference between the charge and the reservation.
- `callWithBudget`: reserve, then call the model inside a `try`. Settle on both paths: after a result, and after an error.
- `traceTotals`: keep only the model spans, split them by whether their usage arrived, and sum each group with its own price.

</details>

<details>
<summary>Hint 3: a detail that's easy to get wrong</summary>

`actualCents || reservation` turns a real `0` into the reservation, because `0` is falsy. `??` replaces only `null` and `undefined`.

</details>

## The solution

On the `solutions` branch, this milestone's code is in [`src/budget.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/budget.mjs) and [`src/trace.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/trace.mjs).
