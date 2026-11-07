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
  const used = budget.users.get(user.id) ?? 0;
  const limit = budget.plans[user.plan].dailyCents;
  if (limit !== null && used + cents > limit) return { ok: false, reason: "user limit" };
  if (budget.total + cents > budget.globalCents) return { ok: false, reason: "global limit" };
  const id = `r${budget.nextId++}`;
  budget.reservations.set(id, { userId: user.id, cents });
  budget.users.set(user.id, used + cents);
  budget.total += cents;
  return { ok: true, id };
}

/**
 * Replaces a reservation with the call's actual cost in cents, or keeps the reservation as the
 * charge when `actualCents` is null because usage never arrived.
 * Returns { ok: true, charged }, or { ok: false, reason: "no such reservation" }.
 */
export function settle(budget, id, actualCents) {
  const reservation = budget.reservations.get(id);
  if (!reservation) return { ok: false, reason: "no such reservation" };
  budget.reservations.delete(id);
  const charge = actualCents ?? reservation.cents; // missing usage keeps the reservation as the charge
  budget.users.set(reservation.userId, budget.users.get(reservation.userId) - reservation.cents + charge);
  budget.total += charge - reservation.cents;
  return { ok: true, charged: charge };
}

/**
 * Makes one model.complete(request) call within the budget, and charges what it cost.
 * Resolves to the model's result, or to { status: "over_budget", text: null, usage: null, reason }
 * without a call when it doesn't fit.
 */
export async function callWithBudget(budget, user, request, model) {
  const reservation = reserve(budget, user, model.worstCaseCents(request));
  if (!reservation.ok) return { status: "over_budget", text: null, usage: null, reason: reservation.reason };
  let result;
  try {
    result = await model.complete(request);
  } catch (error) {
    settle(budget, reservation.id, null); // the call may have been billed: keep the reservation
    throw error;
  }
  settle(budget, reservation.id, result.usage ? model.costCents(result.usage) : null);
  return result;
}
