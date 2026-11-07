// Milestone 4: evals. The retrieval checks use the dataset's labels and rankings recorded from the
// course's vector search. The answer checks use a made-up run, with judge results that never came
// from a real model.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gradeAnswer, retrievalMetrics, summarize } from "../src/evals.mjs";
import { show } from "./helpers.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const { cases: questions, rankings } = read("fixtures/retrieval-run.json");
const { cases } = read("../evals/answer-cases.json");
const run = read("fixtures/answer-run.json");
const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
const grade = (id) => gradeAnswer(caseById.get(id), run.answers[id], run.judge[id]);

test("averages recall over the questions, so one that found 1 of its 3 chunks counts", () => {
  const metrics = retrievalMetrics(questions, rankings, 3);
  assert.equal(
    metrics?.hitRate,
    1,
    `retrievalMetrics gave a hit rate of ${show(metrics?.hitRate)} at k = 3. Every labeled question has a relevant chunk in its top 3, so it should be 1.`,
  );
  assert.equal(
    metrics.recall,
    0.933,
    `retrievalMetrics gave a recall of ${show(metrics.recall)} at k = 3. Average each question's recall@3: 9 questions at 1, and q-cracked-mug at 1 of 3, make 0.933.`,
  );
});

test("takes MRR from the rank of each question's first relevant chunk", () => {
  const metrics = retrievalMetrics(questions, rankings, 3);
  assert.equal(
    metrics?.mrr,
    0.933,
    `retrievalMetrics gave an MRR of ${show(metrics?.mrr)}. Average 1 / first_rank over the questions: q-parcel-never-came's first relevant chunk is third, so it scores 0.333, and the other 9 score 1, for 0.933.`,
  );
});

test("leaves the questions with no relevant chunk out of the retrieval metrics", () => {
  const metrics = retrievalMetrics(questions, rankings, 3);
  assert.equal(
    metrics?.questions,
    10,
    `retrievalMetrics counted ${show(metrics?.questions)} questions. q-no-answer and q-other-tenant have no relevant chunk, so recall has no denominator for them: count the 10 labeled ones.`,
  );
});

test("fails an answer on the code checks first, whatever the judge's verdict", () => {
  const knife = grade("kc-used-knife");
  const expected = { id: "kc-used-knife", grade: "fail", reasons: ['missing "unused"', 'says "full refund"'] };
  assert.deepEqual(
    knife,
    expected,
    `gradeAnswer returned ${show(knife)} for "We'll send you a full refund for the knife", which the judge passed. The code checks come first: it should return ${show(expected)}.`,
  );
  const chair = grade("kc-office-chair");
  assert.deepEqual(
    chair,
    { id: "kc-office-chair", grade: "fail", reasons: ["wrong handoff"] },
    `gradeAnswer returned ${show(chair)} for an answer to a question Kettle & Co's help pages can't answer. It should hand off, so the grade is fail, with the reason "wrong handoff".`,
  );
  const window = grade("kc-refund-window");
  assert.deepEqual(window, { id: "kc-refund-window", grade: "pass", reasons: [] }, `gradeAnswer returned ${show(window)} for a right answer the judge passed. It should pass.`);
});

test("grades a judge result without a clear verdict as ungraded, never as a pass", () => {
  const expected = {
    "kc-cracked-mug": { id: "kc-cracked-mug", grade: "ungraded", reasons: ["filtered"] },
    "dw-desk-lamp": { id: "dw-desk-lamp", grade: "ungraded", reasons: ["unknown verdict: PASS"] },
    "kc-billed-twice": { id: "kc-billed-twice", grade: "ungraded", reasons: ["missing"] },
  };
  const what = { "kc-cracked-mug": "a filtered judge result", "dw-desk-lamp": 'the verdict "PASS"', "kc-billed-twice": "no judge result at all" };
  for (const [id, want] of Object.entries(expected)) {
    const result = grade(id);
    assert.deepEqual(result, want, `gradeAnswer returned ${show(result)} for ${what[id]}. The grader failed, so the answer has no grade yet: ${show(want)}.`);
  }
});

test("counts the ungraded cases as not passed in the pass rate", () => {
  const grades = cases.map((testCase) => grade(testCase.id));
  const summary = summarize(grades, []);
  assert.equal(summary?.passed, 2, `summarize counted ${show(summary?.passed)} passes. Only kc-refund-window and kc-price-match passed.`);
  assert.equal(
    summary.passRate,
    0.286,
    `summarize gave a pass rate of ${show(summary.passRate)}. It divides the passes by every case, ungraded ones too: 2 of 7 is 0.286.`,
  );
  assert.deepEqual(summary.ungraded, ["kc-cracked-mug", "kc-billed-twice", "dw-desk-lamp"], `summarize listed ${show(summary.ungraded)} as ungraded. List every ungraded case's id, in the run's order, so you can rerun them.`);
});

test("lists the cases the baseline passed and this run fails", () => {
  const grades = cases.map((testCase) => grade(testCase.id));
  const summary = summarize(grades, run.baseline);
  assert.deepEqual(
    summary?.broken,
    ["kc-office-chair"],
    `summarize listed ${show(summary?.broken)} as broken. kc-office-chair passed in the baseline and fails now. kc-used-knife failed in both, and kc-cracked-mug is ungraded, so only kc-office-chair is broken.`,
  );
});
