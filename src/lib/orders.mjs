// The two shops' orders, from data/orders.json, the same rows `npm run setup` loads into the
// `orders` table. The tests use these, so they need no database. You don't need to change this file.
//
// An order looks like this. The customer is the email, and an amount is in cents:
//   { id: 1042, tenantId: "kettleandco", email: "chen.wei@example.com", status: "delivered", totalCents: 12900, orderedOn: "2026-09-30" }

import { readFileSync } from "node:fs";

const file = JSON.parse(readFileSync(new URL("../../data/orders.json", import.meta.url), "utf8"));

export const ORDERS = file.orders.map((order) => ({
  id: order.id,
  tenantId: order.tenant,
  email: order.email,
  status: order.status,
  totalCents: Math.round(Number(order.total) * 100),
  orderedOn: order.ordered_on,
}));

/**
 * Returns an async lookup by order id, like a database query: `await findOrder(1042)` gives the
 * order, or null when there's none.
 */
export function orderLookup(orders = ORDERS) {
  const byId = new Map(orders.map((order) => [order.id, order]));
  return async (orderId) => byId.get(orderId) ?? null;
}
