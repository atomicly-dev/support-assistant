// GitHub annotations for the checks that fail. On GitHub Actions, scripts/reporter.mjs prints one
// workflow command per failing check after its usual output, `::error title=<check name>::<message>`,
// and atomicly reads them back from the job's check run to show which checks failed and why.
// scripts/annotations.test.mjs tests these functions.

/** GitHub keeps at most 10 error annotations per step. */
export const MAX_ANNOTATIONS = 10;
const MAX_MESSAGE = 1000;

/** Escapes a command's message, as GitHub's workflow commands require. */
export const escapeData = (text) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/** Escapes a command's property, such as its title: the message's escapes, then `:` and `,`. */
export const escapeProperty = (text) => escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** Cuts a message to at most 1,000 characters, the last one "…". */
export function shorten(message) {
  const chars = [...message];
  return chars.length <= MAX_MESSAGE ? message : `${chars.slice(0, MAX_MESSAGE - 1).join("")}…`;
}

/** At most 10 failures: past 10, the first 9, then one that counts the rest. */
export function limit(failures) {
  if (failures.length <= MAX_ANNOTATIONS) return failures;
  const rest = failures.length - (MAX_ANNOTATIONS - 1);
  return [...failures.slice(0, MAX_ANNOTATIONS - 1), { name: "more checks failed", message: `${rest} more checks failed. See the log.` }];
}

/**
 * One `::error` workflow command for each failure, within the limit.
 * @param {{ name: string, message: string }[]} failures The failed checks' names and messages, in order.
 */
export const annotations = (failures) =>
  limit(failures).map(({ name, message }) => `::error title=${escapeProperty(name)}::${escapeData(shorten(message))}`);
