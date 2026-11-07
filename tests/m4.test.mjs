// Milestone 4: evals. The retrieval checks use the dataset's labels and rankings recorded from the
// course's vector search, and two made-up questions. The answer checks use a made-up run, with judge
// results that never came from a real model. The summarize checks get fixed grades, not your
// gradeAnswer's, so a bug in one function fails only that function's checks.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gradeAnswer, retrievalMetrics, summarize } from "../src/evals.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const { cases: questions, rankings } = read("fixtures/retrieval-run.json");
const labeled = questions.filter((question) => question.relevant.length > 0);
const { cases } = read("../evals/answer-cases.json");
const run = read("fixtures/answer-run.json");
const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));

function grade(testCase, answer, judgeResult) {
  try {
    return gradeAnswer(testCase, answer, judgeResult);
  } catch (error) {
    rethrowNotBuilt(error);
    return `an error: ${error.message}`;
  }
}
const graded = (id) => grade(caseById.get(id), run.answers[id], run.judge[id]);
const judged = (text, status = "complete") => ({ status, text, usage: { input: 310, output: 8 } });

// Made-up questions: q-desk-height found 3 of its 4 relevant chunks in the top 3, and q-cable-tray's
// only relevant chunk is fourth.
const madeUp = [
  { id: "q-desk-height", relevant: ["dw-c1", "dw-c2", "dw-c3", "dw-c4"] },
  { id: "q-cable-tray", relevant: ["dw-c9"] },
];
const madeUpRankings = { "q-desk-height": ["dw-c1", "dw-c2", "dw-c3", "dw-c5", "dw-c4"], "q-cable-tray": ["dw-c5", "dw-c6", "dw-c7", "dw-c9"] };

// The grades the made-up run should get, which the summarize checks start from.
const grades = [
  { id: "kc-refund-window", grade: "pass", reasons: [] },
  { id: "kc-used-knife", grade: "fail", reasons: ['missing "unused"', 'says "full refund"'] },
  { id: "kc-price-match", grade: "pass", reasons: [] },
  { id: "kc-cracked-mug", grade: "ungraded", reasons: ["filtered"] },
  { id: "kc-office-chair", grade: "fail", reasons: ["wrong handoff"] },
  { id: "kc-billed-twice", grade: "ungraded", reasons: ["missing"] },
  { id: "dw-desk-lamp", grade: "ungraded", reasons: ["unknown verdict: PASS"] },
];

test("scores hit rate and recall per question, so one that found 1 of its 3 chunks counts", () => {
  const metrics = retrievalMetrics(labeled, rankings, 3);
  assert.equal(metrics?.hitRate, 1, `retrievalMetrics gave a hit rate of ${show(metrics?.hitRate)} for the 10 labeled questions at k = 3. Each has a relevant chunk in its top 3, so it should be 1.`);
  assert.equal(
    metrics.recall,
    0.933,
    `retrievalMetrics gave a recall of ${show(metrics.recall)} at k = 3. Average each question's recall@3, so each question weighs the same: 9 questions at 1, and q-cracked-mug at 1 of 3, make 0.933.`,
  );
  const other = retrievalMetrics(madeUp, madeUpRankings, 3);
  assert.deepEqual(
    [other?.hitRate, other?.recall],
    [0.5, 0.375],
    `retrievalMetrics gave a hit rate of ${show(other?.hitRate)} and a recall of ${show(other?.recall)} at k = 3 for two made-up questions: q-desk-height has 3 of its 4 relevant chunks in its top 3, and q-cable-tray none of its 1. Divide by each question's relevant chunks: 0.5 and (3/4 + 0) / 2 = 0.375.`,
  );
});

test("takes MRR from each question's first relevant chunk, in the whole ranking", () => {
  for (const k of [3, 2]) {
    const metrics = retrievalMetrics(labeled, rankings, k);
    assert.equal(
      metrics?.mrr,
      0.933,
      `retrievalMetrics gave an MRR of ${show(metrics?.mrr)} at k = ${k}. q-parcel-never-came's first relevant chunk is third. MRR reads the whole ranking, so it scores 1/3 whatever k is, and the other 9 score 1: 0.933.`,
    );
  }
  const other = retrievalMetrics(madeUp, madeUpRankings, 3);
  assert.equal(
    other?.mrr,
    0.625,
    `retrievalMetrics gave an MRR of ${show(other?.mrr)} for two made-up questions, whose first relevant chunks are first and fourth. MRR reads the whole ranking, not only the top k: (1 + 1/4) / 2 = 0.625.`,
  );
});

test("leaves the questions with no relevant chunk out of the retrieval metrics", () => {
  const metrics = retrievalMetrics(questions, rankings, 3);
  const expected = { questions: 10, hitRate: 1, recall: 0.933, mrr: 0.933 };
  assert.deepEqual(
    metrics,
    expected,
    `retrievalMetrics returned ${show(metrics)} for all 12 questions. q-no-answer and q-other-tenant have no relevant chunk, so recall has no denominator for them: leave them out, and count the 10 labeled ones, ${show(expected)}.`,
  );
});

test("fails an answer on the code checks first, then on the judge's verdict", () => {
  const knife = graded("kc-used-knife");
  const expected = { id: "kc-used-knife", grade: "fail", reasons: ['missing "unused"', 'says "full refund"'] };
  assert.deepEqual(knife, expected, `gradeAnswer returned ${show(knife)} for "${run.answers["kc-used-knife"].text}", which the judge passed. The code checks come first: it should return ${show(expected)}.`);
  const chair = graded("kc-office-chair");
  assert.deepEqual(
    chair,
    { id: "kc-office-chair", grade: "fail", reasons: ["wrong handoff"] },
    `gradeAnswer returned ${show(chair)} for an answer to a question Kettle & Co's help pages can't answer. It should hand off, so the grade is fail, with the reason "wrong handoff".`,
  );

  const window = caseById.get("kc-refund-window");
  const pass = judged('{"verdict":"pass"}');
  const handoff = grade(window, { status: "insufficient", text: "A person from our support team will reply soon.", reason: "no sources" }, pass);
  assert.deepEqual(
    handoff?.reasons,
    ["wrong handoff", 'missing "30 days"'],
    `gradeAnswer returned ${show(handoff)} for a handoff on "How many days do I have to ask for a refund?", which the help pages answer. A handoff where none should be is a wrong handoff too: the reasons should be ["wrong handoff", 'missing "30 days"'].`,
  );
  const capital = grade(window, { status: "answered", text: "You have 30 Days from delivery.", citations: ["kc-refund-policy-v2-1"] }, pass);
  assert.equal(capital?.grade, "pass", `gradeAnswer returned ${show(capital)} for "You have 30 Days from delivery.". The phrases are in lowercase, so compare them with the answer's text in lowercase.`);
  const judgeFail = grade(window, run.answers["kc-refund-window"], judged('{"verdict":"fail","reason":"no source says when the 30 days start"}'));
  const failed = { id: "kc-refund-window", grade: "fail", reasons: ["judge: no source says when the 30 days start"] };
  assert.deepEqual(judgeFail, failed, `gradeAnswer returned ${show(judgeFail)} for an answer that passed the code checks, and the judge failed. It should return ${show(failed)}.`);
  const right = graded("kc-refund-window");
  assert.deepEqual(right, { id: "kc-refund-window", grade: "pass", reasons: [] }, `gradeAnswer returned ${show(right)} for a right answer the judge passed. It should pass, with no reasons.`);
});

test("grades a judge result without a clear verdict as ungraded, never as a pass", () => {
  const window = caseById.get("kc-refund-window");
  const answer = run.answers["kc-refund-window"];
  const cases = [
    ["a filtered judge result", graded("kc-cracked-mug"), { id: "kc-cracked-mug", grade: "ungraded", reasons: ["filtered"] }],
    ['the verdict "PASS"', graded("dw-desk-lamp"), { id: "dw-desk-lamp", grade: "ungraded", reasons: ["unknown verdict: PASS"] }],
    ["no judge result at all", graded("kc-billed-twice"), { id: "kc-billed-twice", grade: "ungraded", reasons: ["missing"] }],
    ['the judge text "Pass", which isn\'t JSON', grade(window, answer, judged("Pass")), { id: "kc-refund-window", grade: "ungraded", reasons: ["invalid JSON"] }],
    ['the judge text "null", JSON that isn\'t an object', grade(window, answer, judged("null")), { id: "kc-refund-window", grade: "ungraded", reasons: ["invalid JSON"] }],
    ["a judge result with no status", grade(window, answer, { text: '{"verdict":"pass"}' }), { id: "kc-refund-window", grade: "ungraded", reasons: ["no status"] }],
  ];
  for (const [label, result, want] of cases) {
    assert.deepEqual(result, want, `gradeAnswer returned ${show(result)} for ${label}. The grader failed, so the answer has no grade yet: ${show(want)}.`);
  }
});

test("counts the ungraded cases as not passed in the pass rate", () => {
  const summary = summarize(grades, []);
  assert.deepEqual(
    [summary?.passed, summary?.total],
    [2, 7],
    `summarize counted ${show(summary?.passed)} passes of ${show(summary?.total)} for grades with 2 passes, 2 fails, and 3 ungraded cases. It should count 2 of 7.`,
  );
  assert.equal(summary.passRate, 0.286, `summarize gave a pass rate of ${show(summary.passRate)}. It divides the passes by every case, ungraded ones too: 2 of 7 is 0.286.`);
  assert.deepEqual(summary.ungraded, ["kc-cracked-mug", "kc-billed-twice", "dw-desk-lamp"], `summarize listed ${show(summary.ungraded)} as ungraded. List every ungraded case's id, in the run's order, so you can rerun them.`);
});

test("lists the cases the baseline passed and this run fails", () => {
  const summary = summarize(grades, run.baseline);
  assert.deepEqual(
    summary?.broken,
    ["kc-office-chair"],
    `summarize listed ${show(summary?.broken)} as broken. kc-office-chair passed in the baseline and fails now. kc-used-knife failed in both, and kc-cracked-mug, kc-billed-twice, and dw-desk-lamp are ungraded, not failed, so only kc-office-chair is broken.`,
  );
});

test("leaves a case the baseline never had out of broken", () => {
  // The new case: since the baseline, the team added kc-kettle-fault to the eval set, and it fails.
  const grown = [...grades, { id: "kc-kettle-fault", grade: "fail", reasons: ['missing "2 years"'] }];
  const summary = summarize(grown, run.baseline);
  assert.deepEqual(
    summary?.broken,
    ["kc-office-chair"],
    `summarize listed ${show(summary?.broken)} as broken, after the team added kc-kettle-fault to the eval set. The baseline never ran it, so it never passed it: a new case that fails is a failure to fix, not a broken case. Only kc-office-chair is broken.`,
  );
  assert.equal(summary.passRate, 0.25, `summarize gave a pass rate of ${show(summary.passRate)} for 2 passes of 8 cases. It should be 0.25.`);
});
