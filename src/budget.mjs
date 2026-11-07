// Milestone 6: budgets. See milestones/6-budgets-and-traces.md.
//
// Every model call reserves its worst-case cost before it runs, against the user's daily limit and
// a global one, then settles to what it really cost.

// Each plan's daily limit per user, in cents. null means no per-user limit.
export const PLANS = { trial: { dailyCents: 50 }, subscriber: { dailyCents: null } };

/** One day's budget, in memory: what each user and everyone together reserved or spent, in cents. */
export function createBudget({ plans = PLANS, globalCents = 1000 } = {}) {
  return { plans, globalCents, users: new Map(), reservations: new Map(), total: 0, nextId: 1 };
}

/**
 * Reserves `cents` for one call of `user`, { id, plan }, if it fits both limits.
 * Returns { ok: true, id }, or { ok: false, reason: "user limit" | "global limit" }.
 */
export function reserve(budget, user, cents) {
  throw new Error("Not built yet: milestone 6");
}

/**
 * Replaces a reservation with the call's actual cost in cents, or keeps the reservation as the
 * charge when `actualCents` is null because usage never arrived.
 * Returns { ok: true, charged }, or { ok: false, reason: "no such reservation" }.
 */
export function settle(budget, id, actualCents) {
  throw new Error("Not built yet: milestone 6");
}

/**
 * Makes one model.complete(request) call within the budget, and charges what it cost.
 * Resolves to the model's result, or to { status: "over_budget", text: null, usage: null, reason }
 * without a call when it doesn't fit.
 */
export async function callWithBudget(budget, user, request, model) {
  throw new Error("Not built yet: milestone 6");
}
