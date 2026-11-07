// Runs the evals with your code from milestones 3 and 4, and compares them with evals/baseline.json,
// the score to beat:
//   npm run eval                    the retrieval eval, on the database, with no model call
//   npm run eval -- --live          the answer eval too, with GPT-6 Luna as the assistant and the judge
//   npm run eval -- --live --save   the same, then saves this run as the new baseline
// The retrieval eval uses the questions' stored embeddings, so it needs no key.

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gradeAnswer, judgeRequest, retrievalMetrics, summarize } from "../src/evals.mjs";
import { connect, questionEmbedding } from "../src/lib/db.mjs";
import { openaiModel } from "../src/lib/openai.mjs";
import { answerQuestion, MAX_DISTANCE, MAX_SOURCES, searchChunks } from "../src/retrieval.mjs";

// Reads OPENAI_API_KEY from a .env file in this folder, when there's one. A variable you set in the
// shell wins over the file.
try {
  process.loadEnvFile();
} catch {}

const K = 3;
const BASELINE = new URL("../evals/baseline.json", import.meta.url);
const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, save: { type: "boolean", default: false } } });

if (values.live && !process.env.OPENAI_API_KEY) {
  console.error("--live calls OpenAI's API with your own key, and you pay for the calls. Set OPENAI_API_KEY first, as the README shows.");
  process.exit(1);
}

let db;
try {
  db = await connect();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

try {
  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  const retrieval = await retrievalEval(baseline.retrieval);
  const answers = values.live ? await answerEval(baseline.answers) : baseline.answers;
  if (values.save) {
    await writeFile(BASELINE, `${JSON.stringify({ retrieval, answers }, null, 2)}\n`);
    console.log("\nSaved this run to evals/baseline.json. It's the score to beat now.");
  }
} catch (error) {
  if (/^Not built yet/.test(error.message)) console.error(`${error.message}. The eval runs your code, so build that milestone first.`);
  else console.error(`The eval failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}

async function retrievalEval(before) {
  const { rows: cases } = await db.query(`
    SELECT q.id, q.tenant_id AS shop, coalesce(array_agg(rc.chunk_id) FILTER (WHERE rc.chunk_id IS NOT NULL), '{}') AS relevant
    FROM questions q LEFT JOIN relevant_chunks rc ON rc.question_id = q.id
    GROUP BY q.id ORDER BY q.id`);
  const rankings = {};
  const nearest = {};
  for (const testCase of cases) {
    const rows = await searchChunks(db, { tenantId: testCase.shop }, await questionEmbedding(db, testCase.id), 50);
    rankings[testCase.id] = rows.map((row) => row.id);
    nearest[testCase.id] = rows[0]?.distance ?? Infinity;
  }
  const metrics = { k: K, ...retrievalMetrics(cases, rankings, K) };
  console.log(`Retrieval eval: ${metrics.questions} labeled questions of ${cases.length}, k = ${K}`);
  for (const [key, label] of [["hitRate", "hit rate"], ["recall", `recall@${K}`], ["mrr", "MRR"]]) {
    console.log(`  ${label.padEnd(9)} ${metrics[key].toFixed(3)}  (baseline ${before?.[key]?.toFixed(3) ?? "none"})`);
  }
  const missed = cases.filter((c) => c.relevant.some((id) => !rankings[c.id].slice(0, K).includes(id)));
  for (const c of missed) {
    const found = c.relevant.filter((id) => rankings[c.id].slice(0, K).includes(id)).length;
    console.log(`  ${c.id} has ${found} of its ${c.relevant.length} relevant chunks in the top ${K}`);
  }
  // The handoff policy from milestone 3: no chunk within MAX_DISTANCE means a person answers.
  const wrong = cases.filter((c) => c.relevant.length > 0 === nearest[c.id] > MAX_DISTANCE).map((c) => c.id);
  console.log(`  Handoff at ${MAX_DISTANCE} is wrong for ${wrong.length} of ${cases.length} questions${wrong.length ? `: ${wrong.join(", ")}` : ""}`);
  const wrongBefore = before?.handoffWrong;
  if (Array.isArray(wrongBefore)) {
    const same = wrongBefore.length === wrong.length && wrongBefore.every((id) => wrong.includes(id));
    if (same && wrong.length > 0) {
      console.log(`    The baseline has the same ${wrong.length}. The ${MAX_DISTANCE} limit is a policy to tune, not a bug in your search: section 3 of Retrieval evals shows why.`);
    } else if (!same) {
      console.log(`    The baseline has ${wrongBefore.length}${wrongBefore.length ? `: ${wrongBefore.join(", ")}` : ""}.`);
    }
  }
  // A permissions check: if a change drops the shop filter, this fails at once.
  const { rows } = await db.query("SELECT id, tenant_id FROM chunks");
  const shopOf = new Map(rows.map((row) => [row.id, row.tenant_id]));
  const leaks = cases.flatMap((c) => rankings[c.id].slice(0, K).filter((id) => shopOf.get(id) !== c.shop));
  console.log(`  Other shops' chunks in a top ${K}: ${leaks.length}${leaks.length ? ` (${leaks.join(", ")})` : ""}`);
  return { ...metrics, handoffWrong: wrong };
}

async function answerEval(before = []) {
  const { cases } = JSON.parse(await readFile(new URL("../evals/answer-cases.json", import.meta.url), "utf8"));
  const model = openaiModel(process.env.OPENAI_API_KEY);
  console.log(`\nAnswer eval: ${cases.length} cases`);
  const grades = [];
  for (const testCase of cases) {
    const rows = await searchChunks(db, { tenantId: testCase.shop }, await model.embed(testCase.question), 5);
    const answer = await answerQuestion(testCase.question, rows, model);
    // The judge reads the same sources the answer was given.
    const sources = rows.filter((row) => row.distance <= MAX_DISTANCE).slice(0, MAX_SOURCES);
    const judged = await model.complete(judgeRequest(testCase.question, answer, sources)).catch(() => undefined);
    const grade = gradeAnswer(testCase, answer, judged);
    grades.push(grade);
    console.log(`  ${grade.id.padEnd(18)} ${grade.grade}${grade.reasons.length ? `: ${grade.reasons.join(", ")}` : ""}`);
  }
  const summary = summarize(grades, before);
  const beforeSummary = before.length > 0 ? summarize(before, []) : null;
  console.log(`  Passed ${summary.passed} of ${summary.total}, a pass rate of ${summary.passRate.toFixed(3)} (baseline ${beforeSummary?.passRate.toFixed(3) ?? "none"})`);
  if (summary.ungraded.length) console.log(`  Ungraded, rerun before you compare: ${summary.ungraded.join(", ")}`);
  if (summary.broken.length) console.log(`  The baseline passed these, and this run fails them: ${summary.broken.join(", ")}`);
  return grades.map(({ id, grade }) => ({ id, grade }));
}
