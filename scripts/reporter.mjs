// A node:test reporter that prints each check by name, with the reason when it fails, and a count at
// the end. scripts/milestone.mjs runs each milestone's tests with it.

const NOT_BUILT = /^Not built yet: milestone \d$/;

export default async function* reporter(source) {
  let passed = 0;
  let failed = 0;
  for await (const event of source) {
    const { data } = event;
    if (event.type === "test:stdout" || event.type === "test:stderr") yield data.message;
    if (data?.nesting !== 0 || data.details?.type === "suite") continue;
    if (event.type === "test:pass") {
      passed++;
      yield `  ✔ ${data.name}\n`;
    } else if (event.type === "test:fail") {
      failed++;
      yield `  ✖ ${data.name}\n${indent(describe(data.details.error))}\n`;
    }
  }
  const label = process.env.MILESTONE ? `Milestone ${process.env.MILESTONE}` : "Total";
  yield `\n${label}: ${passed} of ${passed + failed} checks pass\n`;
}

function describe(error) {
  const cause = error?.cause ?? error;
  if (!(cause instanceof Error)) return String(cause);
  // A check's own message says what came back and what should have. Node adds a diff after it.
  if (cause.code === "ERR_ASSERTION") return cause.generatedMessage ? cause.message : cause.message.split("\n")[0];
  if (NOT_BUILT.test(cause.message)) return cause.message;
  // Any other error came from the code under test: show where your code in src/ threw it.
  const frame = cause.stack?.split("\n").find((line) => line.includes("/src/") && !line.includes("/src/lib/"));
  return `${cause.name}: ${cause.message}${frame ? `\n${frame.trim()}` : ""}`;
}

const indent = (text) => text.replace(/^/gm, "      ");
