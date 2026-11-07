# Milestone 4: Evals

Lessons: [Evals: grade a prompt change on labeled tickets](https://atomicly.dev/lessons/ai-first-eval), [Retrieval evals: find whether retrieval lost the answer](https://atomicly.dev/lessons/ai-retrieval-evals), and [LLM-as-a-judge: grade quality without trusting the grader](https://atomicly.dev/lessons/ai-answer-evals)

## The situation

A customer writes "My mug arrived cracked. What are my options?", and the answer never says how to report the damage. Was the prompt wrong, or did the chunk that says it never reach the prompt? And when the team tried a model as a grader, it passed a fluent answer that promised a full refund on a used knife.

You can't tell a better assistant from a worse one by trying a question or two. So you'll build the evals that measure it, and a score each change has to beat.

## What you build

All three functions go in `src/evals.mjs`. The file already has the judge's rubric and `judgeRequest(question, answer, sources)`.

**`retrievalMetrics(cases, rankings, k)`** scores retrieval on labeled questions:

- `cases` are `{ id, relevant, ... }`. `relevant` lists the ids of the chunks that answer the question, and can be empty.
- `rankings` is a plain object from each question's id to its chunk ids, nearest first, such as `{ "q-sku": ["kc-warranty-v1-3", "kc-kettle-care-v1-2", ...] }`.

It returns `{ questions, hitRate, recall, mrr }`. Each metric is a number rounded to 3 decimals, such as `0.933`:

- `questions`: how many questions the metrics count
- `hitRate`: the share of questions with a relevant chunk in their top `k`
- `recall`: recall@k, averaged over the questions
- `mrr`: the mean reciprocal rank of each question's first relevant chunk

**`gradeAnswer(testCase, answer, judgeResult)`** grades one answer:

- `testCase` is a case from `evals/answer-cases.json`: `{ id, mustSay, mustNotSay, shouldHandOff, ... }`, with the phrases in lowercase.
- `answer` is `answerQuestion`'s result from milestone 3: `{ status: "answered", text, citations }` or `{ status: "insufficient", text, reason }`.
- `judgeResult` is the judge's model result, `{ status, text, usage }` like milestone 1's, or `undefined` when the judge call stored nothing. A clear verdict is the text `{"verdict":"pass"}` or `{"verdict":"fail","reason":"..."}`.

It returns `{ id, grade, reasons }`. `grade` is `"pass"`, `"fail"`, or `"ungraded"`:

| When | `grade` | `reasons` |
| --- | --- | --- |
| `shouldHandOff` doesn't match whether the answer hands off | `"fail"` | `"wrong handoff"` |
| the text lacks a `mustSay` phrase | `"fail"` | `` `missing "${phrase}"` `` for each one |
| the text has a `mustNotSay` phrase | `"fail"` | `` `says "${phrase}"` `` for each one |
| there's no judge result | `"ungraded"` | `"missing"` |
| the judge result has no status | `"ungraded"` | `"no status"` |
| its status isn't `"complete"` | `"ungraded"` | the status |
| its text isn't JSON | `"ungraded"` | `"invalid JSON"` |
| its verdict isn't exactly `"pass"` or `"fail"` | `"ungraded"` | `` `unknown verdict: ${verdict}` `` |
| the verdict is `"fail"` | `"fail"` | `` `judge: ${reason}` `` |
| the verdict is `"pass"` | `"pass"` | none |

An answer hands off when its status is `"insufficient"`. The code checks' reasons come in the order of the table.

**`summarize(grades, baseline)`** sums up a run's grades, and compares them with `baseline`, an earlier run's `{ id, grade }` list. It returns `{ passed, total, passRate, ungraded, broken }`:

- `passed` and `total`: the passes, and every case
- `passRate`: the passes divided by every case, rounded to 3 decimals
- `ungraded`: the ungraded cases' ids, in the run's order, so you can rerun them
- `broken`: the ids the baseline passed and this run grades `"fail"`

## The rules

- A question with no relevant chunk counts in none of the metrics, because recall has no denominator for it.
- Each question weighs the same in recall, however many relevant chunks it has.
- MRR reads the whole ranking, so a first relevant chunk below the top `k` still counts.
- The code checks come first: an answer that fails one is `"fail"`, whatever the judge's verdict.
- A phrase matches whatever the case of the answer's letters.
- Anything but a clear verdict is ungraded, never a pass.
- The pass rate counts an ungraded case as not passed.
- An ungraded case isn't broken. Rerun it before you compare.

## The new case

Since the baseline, the team added a case to the eval set, `kc-kettle-fault`, after a wrong answer about the kettle's warranty. It fails in this run. It isn't broken, though: the baseline never ran it, so it never passed it. It's a failure to fix. The check **leaves a case the baseline never had out of broken** tests it.

## Run the checks

```sh
npm run milestone -- 4
```

The checks use the dataset's labels with rankings recorded from the course's vector search, in `tests/fixtures/retrieval-run.json`, and a few made-up questions. The answer checks use a made-up run with judge results, in `tests/fixtures/answer-run.json`. The `summarize` checks start from fixed grades, so a bug in `gradeAnswer` fails only its own checks. They need no database:

- scores hit rate and recall per question, so one that found 1 of its 3 chunks counts
- takes MRR from each question's first relevant chunk, in the whole ranking
- leaves the questions with no relevant chunk out of the retrieval metrics
- fails an answer on the code checks first, then on the judge's verdict
- grades a judge result without a clear verdict as ungraded, never as a pass
- counts the ungraded cases as not passed in the pass rate
- lists the cases the baseline passed and this run fails
- leaves a case the baseline never had out of broken

## The score to beat

Once milestones 3 and 4 pass, run the evals on your own code:

```sh
npm run eval
```

It runs your `searchChunks` on all 12 questions, with their stored embeddings, so it needs no key. It prints:

- your hit rate, recall@3, and MRR, next to the baseline's in `evals/baseline.json`: 1.000, 0.933, and 0.933, the course's vector search
- the questions that missed a relevant chunk
- the questions where the 0.55 handoff limit is wrong, and whether the baseline has the same ones
- any other shop's chunk in a top 3

The baseline has the same 3 wrong handoffs. The limit is a policy to tune, not a bug in your code: section 3 of [Retrieval evals](https://atomicly.dev/lessons/ai-retrieval-evals) shows why.

With `--live`, it runs the answer eval too: your `searchChunks` and `answerQuestion` on each case in `evals/answer-cases.json`, graded by a GPT-6 Luna judge, with your own key, as in [the README](../README.md#ask-with-a-real-model). `npm run eval -- --live --save` saves that run as the new baseline, the score your next change has to beat without breaking a case it passed.

## Hints

Open them one at a time, when you're stuck.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Retrieval evals](https://atomicly.dev/lessons/ai-retrieval-evals): section 2, *Three metrics, three questions*, computes the three metrics in SQL. The end of the section explains why the questions with no answer are left out.
- [LLM-as-a-judge](https://atomicly.dev/lessons/ai-answer-evals): section 1, *Check what code can check first*, and section 2, *A model grader is untrusted input*.
- [Evals](https://atomicly.dev/lessons/ai-first-eval): section 5, *Compare the failures, not the totals*.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `retrievalMetrics`: leave out the questions with no relevant chunk first. For each question that's left, count its relevant chunks in the top `k`, and find the rank of its first relevant chunk in the whole ranking. Then average each metric over the questions.
- `gradeAnswer`: collect the code checks' failures in a list, and return a fail when it isn't empty. Then read the judge's verdict in a helper that returns a grade, or the reason it can't give one.
- `summarize`: keep the baseline's passes in a `Set`, and look up each of this run's fails in it.

</details>

<details>
<summary>Hint 3: a detail that's easy to get wrong</summary>

`x.toFixed(3)` returns a string, such as `"0.933"`. `Number(x.toFixed(3))` turns it back into the number `0.933`.

</details>

## The solution

The `solutions` branch has every milestone built. This one is in [`src/evals.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/evals.mjs).
