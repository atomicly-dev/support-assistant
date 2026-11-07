// Asks the support assistant one question, with a real model and your own OpenAI API key:
//   npm run ask -- "Where is order 1042?" --live
//   npm run ask -- "How long do I have to return a desk lamp?" --live --shop deskworks --customer pia.lund@example.com
// It needs every milestone built, the database from `npm run setup`, and OPENAI_API_KEY in the
// environment or in a .env file. The tests never run it.

import { parseArgs } from "node:util";
import { handle } from "../src/assistant.mjs";
import { createBudget, PLANS } from "../src/budget.mjs";
import { connect, findOrderInDb } from "../src/lib/db.mjs";
import { createDesk } from "../src/lib/desk.mjs";
import { MODEL, openaiModel } from "../src/lib/openai.mjs";
import { traceTotals } from "../src/trace.mjs";

// Reads OPENAI_API_KEY from a .env file in this folder, when there's one. A variable you set in the
// shell wins over the file.
try {
  process.loadEnvFile();
} catch {}

const SHOPS = { kettleandco: "Kettle & Co", deskworks: "Deskworks" };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    live: { type: "boolean", default: false },
    shop: { type: "string", default: "kettleandco" },
    customer: { type: "string", default: "chen.wei@example.com" },
    plan: { type: "string", default: "trial" },
  },
});

const message = positionals.join(" ").trim();
if (!message) {
  console.error('Ask a question: npm run ask -- "Where is order 1042?" --live');
  process.exit(2);
}
if (!SHOPS[values.shop]) {
  console.error(`--shop must be one of ${Object.keys(SHOPS).join(", ")}.`);
  process.exit(2);
}
if (!PLANS[values.plan]) {
  console.error(`--plan must be one of ${Object.keys(PLANS).join(", ")}.`);
  process.exit(2);
}
if (!values.live) {
  console.error("The assistant needs a real model to answer a new question, so `ask` runs only with --live:");
  console.error(`  npm run ask -- ${JSON.stringify(message)} --live`);
  console.error("The milestone checks use a fake model instead, and need no key: npm run milestone -- all");
  process.exit(2);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("--live calls OpenAI's API with your own key, and you pay for the calls. Set OPENAI_API_KEY first:");
  console.error("  export OPENAI_API_KEY=sk-...");
  console.error("Or put the line OPENAI_API_KEY=sk-... in a file named .env in this folder. Git ignores it, so it stays out of your commits.");
  process.exit(1);
}

let db;
try {
  db = await connect();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const session = { tenantId: values.shop, email: values.customer, plan: values.plan };
const budget = createBudget();
const desk = createDesk((orderId) => findOrderInDb(db, orderId));
console.log(`${SHOPS[session.tenantId]}, ${session.email}, ${session.plan} plan, ${MODEL}\n`);

try {
  const result = await handle(message, session, { model: openaiModel(process.env.OPENAI_API_KEY), db, budget, desk, write: (text) => process.stdout.write(text) });
  if (result.citations?.length) console.log(`\nSources: ${result.citations.join(", ")}`);
  for (const [id, proposal] of desk.proposals) {
    console.log(`\nProposal ${id}: refund ${proposal.amountCents} cents on order ${proposal.orderId}, awaiting a support agent's approval.`);
  }
  printTrace(result);
} catch (error) {
  if (/^Not built yet/.test(error.message)) console.error(`\n${error.message}. \`ask\` runs your code from every milestone, so build them all first.`);
  else console.error(`\nThe request failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}

function printTrace({ route, status, reason, spans }) {
  console.log(`\nTrace: route ${route ?? "none"}, ${status}${reason ? ` (${reason})` : ""}`);
  for (const span of spans) {
    const name = span.step ? `${span.name} ${span.step}` : span.name;
    const ms = span.ms === undefined ? "" : `${span.ms} ms`;
    let detail = span.outcome ?? "";
    if (span.name === "model") detail = `${span.status}, ${span.usage ? `${span.usage.input} in, ${span.usage.output} out` : "no usage"}`;
    if (span.name === "retrieve") detail = `${span.chunks} chunks`;
    console.log(`  ${name.padEnd(20)} ${ms.padStart(8)}  ${detail}`);
  }
  const { fromUsage, estimated } = traceTotals(spans);
  console.log(`Cost of the chat calls: $${fromUsage.toFixed(6)} from usage, $${estimated.toFixed(6)} estimated`);
  const used = budget.users.get(session.email) ?? 0;
  const limit = budget.plans[session.plan].dailyCents;
  console.log(`Budget: ${used.toFixed(4)} cents of ${limit === null ? "no per-user limit" : `${limit} cents`}, kept in memory for this run`);
}
