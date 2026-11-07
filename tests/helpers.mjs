// Shared by the milestone tests.

import { inspect } from "node:util";

/** A value on one line, as the failure messages show it. */
export const show = (value) => inspect(value, { depth: 8, breakLength: Infinity, compact: true });

/** Lets a stub's "Not built yet" error through a check's own try/catch, so the output shows it. */
export function rethrowNotBuilt(error) {
  if (/^Not built yet: milestone \d$/.test(error?.message)) throw error;
}
