# Milestone 4: Evals

Lessons: [Evals: grade a prompt change on labeled tickets](https://atomicly.dev/lessons/ai-first-eval), [Retrieval evals: find whether retrieval lost the answer](https://atomicly.dev/lessons/ai-retrieval-evals), and [LLM-as-a-judge: grade quality without trusting the grader](https://atomicly.dev/lessons/ai-answer-evals)

## The situation

A customer writes "My mug arrived cracked. What are my options?", and the answer never says how to report the damage. Was the prompt wrong, or did the chunk that says it never reach the prompt? And when the team tried a model as a grader, it passed a fluent answer that promised a full refund on a used knife.

You can't tell a better assistant from a worse one by trying a question or two. So this milestone builds the evals that measure it, and a score each change has to beat.

## What you build

All three functions go in `src/evals.mjs`.

**`retrievalMetrics(cases, rankings, k)`** scores retrieval on labeled questions. `cases` are `{ id, relevant }`, with the ids of the chunks that answer each question, and `rankings` maps each question's id to its chunk ids, nearest first. It returns `{ questions, hitRate, recall, mrr }`, each rounded to 3 decimals with `Number(x.toFixed(3))`:

- Leave out the questions whose `relevant` list is empty. `questions` counts the rest.
- `hitRate`: the share of questions with at least one relevant chunk in the top `k`.
- `recall`: each question's relevant chunks in the top `k`, divided by its relevant chunks, averaged over the questions.
- `mrr`: each question's `1 / rank` of its first relevant chunk in the whole ranking, averaged over the questions. A question whose ranking has none scores 0.

**`gradeAnswer(testCase, answer, judgeResult)`** grades one answer. `testCase` is a case from `evals/answer-cases.json`: `{ id, mustSay, mustNotSay, shouldHandOff }`, with the phrases in lowercase. `answer` is `answerQuestion`'s result from milestone 3, and `judgeResult` is the judge's model result, or `undefined` when the judge call stored nothing. It returns `{ id, grade, reasons }`:

1. The code checks come first. The answer fails with `"wrong handoff"` when `shouldHandOff` doesn't match `answer.status === "insufficient"`, with `` `missing "${phrase}"` `` for each `mustSay` phrase its lowercased text lacks, and with `` `says "${phrase}"` `` for each `mustNotSay` phrase it has. Any of these makes the grade `"fail"`, whatever the judge's verdict.
2. Then the judge's verdict. Anything but a clear verdict is `"ungraded"`, never a pass: a missing result (reason `"missing"`), a status that isn't `"complete"` (the status), text that isn't JSON (`"invalid JSON"`), or a verdict that isn't exactly `"pass"` or `"fail"` (`` `unknown verdict: ${verdict}` ``).
3. `{"verdict":"fail","reason":"..."}` is a `"fail"`, with the judge's reason after `judge: `, and `{"verdict":"pass"}` is a `"pass"`, with no reasons.

**`summarize(grades, baseline)`** sums up a run, and compares it with the baseline, an earlier run's grades. It returns `{ passed, total, passRate, ungraded, broken }`:

- `passRate` divides the passes by every case, ungraded ones too, rounded to 3 decimals.
- `ungraded` lists the ungraded cases' ids, in the run's order, so you can rerun them.
- `broken` lists the ids the baseline passed and this run fails.

The file already has the judge's rubric and `judgeRequest(question, answer, sources)`.

## Run the checks

```sh
npm run milestone -- 4
```

The checks use the dataset's labels with rankings recorded from the course's vector search, in `tests/fixtures/retrieval-run.json`, and a made-up answer run with judge results, in `tests/fixtures/answer-run.json`. They need no database:

- averages recall over the questions, so one that found 1 of its 3 chunks counts
- takes MRR from the rank of each question's first relevant chunk
- leaves the questions with no relevant chunk out of the retrieval metrics
- fails an answer on the code checks first, whatever the judge's verdict
- grades a judge result without a clear verdict as ungraded, never as a pass
- counts the ungraded cases as not passed in the pass rate
- lists the cases the baseline passed and this run fails

## The score to beat

Once milestones 3 and 4 pass, run the evals on your own code:

```sh
npm run eval
```

It runs your `searchChunks` on all 12 labeled questions, with their stored embeddings, so it needs no key. It prints your hit rate, recall@3, and MRR next to the baseline in `evals/baseline.json`: 1.000, 0.933, and 0.933, the course's vector search. It also lists the questions that missed a relevant chunk, the questions where the 0.55 handoff limit is wrong, and any other shop's chunk in a top 3.

With `--live`, it runs the answer eval too: your assistant and a GPT-6 Luna judge on each case in `evals/answer-cases.json`, with your own key, as in [the README](../README.md#ask-with-a-real-model). `npm run eval -- --live --save` saves that run as the new baseline, the score your next change has to beat without breaking a case it passed.

## Hints

- Section 2 of [Retrieval evals](https://atomicly.dev/lessons/ai-retrieval-evals), *Three metrics, three questions*, computes all three metrics in SQL, on the same 10 questions. Section 3, *Questions with no answer*, says why they're left out.
- Section 1 of [LLM-as-a-judge](https://atomicly.dev/lessons/ai-answer-evals), *Check what code can check first*, writes the code checks, and section 2, *A model grader is untrusted input*, writes the verdict reader and the pass rate.
- Section 5 of [Evals](https://atomicly.dev/lessons/ai-first-eval), *Compare the failures, not the totals*, finds the broken cases.

## The solution

The `solutions` branch has every milestone built. This one is in [`src/evals.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/evals.mjs).
