# Milestone 4: Evals

Read this on atomicly, with the tutor next to it: [milestone 4 on atomicly](https://atomicly.dev/projects/proj-support-assistant/milestones/proj-support-m4).

Lessons: [Evals: grade a prompt change on labeled tickets](https://atomicly.dev/lessons/ai-first-eval), [Retrieval evals: find whether retrieval lost the answer](https://atomicly.dev/lessons/ai-retrieval-evals), and [LLM-as-a-judge: grade quality without trusting the grader](https://atomicly.dev/lessons/ai-answer-evals)

## The situation

A customer writes "My mug arrived cracked. What are my options?" and the answer never says how to report the damage. Was the prompt wrong, or did the chunk that explains it never make it into the prompt? And when the team tried a model as a grader, it passed a fluent answer that promised a full refund on a used knife.

You can't tell a better assistant from a worse one by trying a question or two. So you'll build evals to measure that, and a score every change has to beat.

## What you build

You'll write all three functions in `src/evals.mjs`, next to the judge's rubric and `judgeRequest(question, answer, sources)`, which are already there.

**`retrievalMetrics(cases, rankings, k)`** scores retrieval on labeled questions:

- `cases` are `{ id, relevant, ... }`. `relevant` lists the ids of the chunks that answer the question, and can be empty.
- `rankings` is a plain object that maps each question's id to its chunk ids, nearest first, such as `{ "q-sku": ["kc-warranty-v1-3", "kc-kettle-care-v1-2", ...] }`.

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
| its JSON isn't an object, such as `null` | `"ungraded"` | `"invalid JSON"` |
| its verdict isn't exactly `"pass"` or `"fail"` | `"ungraded"` | `` `unknown verdict: ${verdict}` `` |
| the verdict is `"fail"` | `"fail"` | `` `judge: ${reason}` `` |
| the verdict is `"pass"` | `"pass"` | none |

An answer hands off when its status is `"insufficient"`. List the code checks' reasons in the table's order.

**`summarize(grades, baseline)`** sums up a run's grades, and compares them with `baseline`, an earlier run's `{ id, grade }` list. It returns `{ passed, total, passRate, ungraded, broken }`:

- `passed` and `total`: the number of passes, and the number of cases
- `passRate`: `passed` divided by `total`, rounded to 3 decimals
- `ungraded`: the ungraded cases' ids, in the run's order, so you can rerun them
- `broken`: the ids of the cases that got worse since the baseline

## The rules

- A question with no relevant chunk is left out of every metric, because recall has no denominator for it.
- Each question counts the same in recall, however many relevant chunks it has.
- MRR uses the whole ranking, so a first relevant chunk below the top `k` still counts.
- The code checks come first: an answer that fails one is `"fail"`, whatever the judge's verdict.
- Phrase matching ignores upper and lower case.
- Anything but a clear verdict is ungraded, never a pass.
- The pass rate counts an ungraded case as not passed.
- An ungraded case isn't broken. Rerun it before you compare.

## The new case

Since the baseline, the team added a case to the eval set, `kc-kettle-fault`, after a wrong answer about the kettle's warranty. The new case fails in this run. Is it broken? The check "doesn't count a case the baseline never had as broken" tests your answer.

## Run the checks

```sh
npm run milestone -- 4
```

The retrieval checks use the dataset's labels, rankings recorded from the course's vector search in `tests/fixtures/retrieval-run.json`, and two made-up questions. The answer checks use a made-up run with judge results, in `tests/fixtures/answer-run.json`. The `summarize` checks start from fixed grades, so a bug in `gradeAnswer` fails only its own checks. None of them need the database:

- scores hit rate and recall per question, so one that found 1 of its 3 chunks counts
- takes MRR from each question's first relevant chunk, in the whole ranking
- leaves the questions with no relevant chunk out of the retrieval metrics
- fails an answer on the code checks first, then on the judge's verdict
- grades a judge result without a clear verdict as ungraded, never as a pass
- counts the ungraded cases as not passed in the pass rate
- lists the cases the baseline passed and this run fails
- doesn't count a case the baseline never had as broken

## The score to beat

Once milestones 3 and 4 pass, run the evals on your own code:

```sh
npm run eval
```

It runs your `searchChunks` on all 12 questions with their stored embeddings, so you don't need a key. It prints:

- your hit rate, recall@3, and MRR, next to the baseline's from the course's vector search, in `evals/baseline.json`: 1.000, 0.933, and 0.933
- the questions that missed a relevant chunk
- the questions the 0.55 handoff limit gets wrong, and whether the baseline has the same ones
- any other shop's chunk in a top 3

The baseline has the same 3 wrong handoffs. The limit is a policy to tune, not a bug in your code: section 3 of [Retrieval evals](https://atomicly.dev/lessons/ai-retrieval-evals) shows why.

With `--live`, it also runs the answer eval, with your own key as in [the README](../README.md#ask-with-a-real-model): your `searchChunks` and `answerQuestion` on each case in `evals/answer-cases.json`, graded by a GPT-6 Luna judge. `npm run eval -- --live --save` saves that run as the new baseline. Your next change has to beat it without breaking a case it passed.

## Hints

Stuck? The hints go from where the course teaches this, to the approach, to a detail people often get wrong.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Retrieval evals](https://atomicly.dev/lessons/ai-retrieval-evals): in section 2, *Three metrics, three questions*, the lesson computes the three metrics in SQL. The end of that section explains why questions with no answer are left out.
- [LLM-as-a-judge](https://atomicly.dev/lessons/ai-answer-evals): section 1, *Check what code can check first*, and section 2, *A model grader is untrusted input*.
- [Evals](https://atomicly.dev/lessons/ai-first-eval): section 5, *Compare the failures, not the totals*.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `retrievalMetrics`: leave out the questions with no relevant chunk first. For each question that's left, count its relevant chunks in the top `k`, and find the rank of its first relevant chunk in the whole ranking. Then average each metric over the questions.
- `gradeAnswer`: collect the code checks' failures in a list, and return a fail when it isn't empty. Then read the judge's verdict in a helper that returns either a grade or the reason there isn't one.
- `summarize`: put the baseline's passes in a `Set`, and look up each of this run's fails in it.

</details>

<details>
<summary>Hint 3: a detail that's easy to get wrong</summary>

`x.toFixed(3)` returns a string, such as `"0.933"`. `Number(x.toFixed(3))` turns it back into the number `0.933`.

</details>

## The solution

On the `solutions` branch, this milestone's code is in [`src/evals.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/evals.mjs).
