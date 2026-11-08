# Milestone 3: Retrieval

Read this on atomicly, with the tutor next to it: [milestone 3 on atomicly](https://atomicly.dev/projects/proj-support-assistant/milestones/proj-support-m3).

Lessons: [Embeddings: what a vector lets you compare](https://atomicly.dev/lessons/ai-embeddings), [Vector search: find the nearest authorized chunks](https://atomicly.dev/lessons/ai-vector-search), and [RAG: ground the answer in retrieved chunks](https://atomicly.dev/lessons/ai-grounded-answers)

## The situation

A Kettle & Co customer asks "How many days do I have to ask for a refund?" Both shops' help pages are in one `chunks` table, and each chunk has a real embedding. Sort them all by cosine distance, and the nearest chunk is Deskworks' refund policy, which says 60 days. Next comes Kettle & Co's old policy, version 1, which says 14. Kettle & Co's current answer, 30 days, is only third.

And even when the assistant found the right chunk, the model once cited a chunk the search never returned.

## What you build

All three functions go in `src/retrieval.mjs`. It already has `MAX_DISTANCE` (0.55), `MAX_SOURCES` (4), `HANDOFF`, `ANSWER_INSTRUCTIONS`, `ANSWER_FORMAT`, and `evidenceBlock(sources)`.

**`searchChunks(db, session, embedding, limit = 5)`** finds the chunks nearest to a question's embedding:

- `db` is a pg Pool from `src/lib/db.mjs`. `await db.query(sql, values)` resolves to `{ rows }`.
- `session` is `{ tenantId, ... }`, from the customer's login.
- `embedding` is an array of 256 numbers.

It resolves to at most `limit` rows `{ id, content, distance }`, where `distance` is the cosine distance, as a number. You'll find the tables in `data/ai-support.sql`. Each chunk has its shop's `tenant_id`, its document's `document_id`, and the `version` of the document it comes from. Each version of a document has a `status`, `'current'` or `'stale'`.

**`checkCitations(answer, sources)`** checks a reply's citations against the sources you sent. `answer` is the model's parsed reply, `{ status, text, citations }`, and `sources` are rows like the ones `searchChunks` returns:

| The reply | It returns |
| --- | --- |
| `status` is `"insufficient"` | `{ ok: true }` |
| it cites only the sources' ids | `{ ok: true }` |
| it cites nothing | `{ ok: false, reason }`, with any reason you like |
| it cites ids that weren't sent | `{ ok: false, reason: "cited chunks that weren't sent: <ids>" }` |

`<ids>` is every unknown id, in the order of the citations, joined with `, `.

**`answerQuestion(question, rows, model)`** answers from the rows `searchChunks` returned, nearest first, with at most one `model.complete(request)` call. `model.complete` resolves to a result like milestone 1's, `{ status, text, usage }`. A complete reply's text is JSON in the shape of `ANSWER_FORMAT`: `{ status, text, citations }`. The request has:

- a developer message with `ANSWER_INSTRUCTIONS`
- a user message with the sources from `evidenceBlock`, and the question between `<question>` and `</question>`
- `response_format: ANSWER_FORMAT`, and `max_completion_tokens: 400`

`answerQuestion` resolves to `{ status: "answered", text, citations }`, or to `{ status: "insufficient", text: HANDOFF, reason }`, so a person answers instead:

| When | `reason` |
| --- | --- |
| no row is a source | `"no sources"` |
| the result isn't complete | its status, such as `"refused"` |
| its text isn't JSON | `"invalid JSON"` |
| its JSON isn't an object, such as `null` | `"invalid JSON"` |
| the reply's own status is `"insufficient"` | `"insufficient"` |
| `checkCitations` fails | `checkCitations`' reason |

## The rules

- `searchChunks` finds only chunks from the session's shop, and only from each document's current version.
- Another shop's chunk or an old version never leaves the database, so neither one uses up one of the `limit` places.
- The rows come nearest first. Two rows at the same distance come in id order, so every run returns the same rows.
- A tenant id that matches no shop returns no rows, even one with a quote in it, such as `kettleandco' OR 'x' = 'x`.
- The sources are the nearest rows at a distance of at most `MAX_DISTANCE`, up to `MAX_SOURCES` of them. When there are none, `answerQuestion` hands off without calling the model.
- Parse only a complete result.
- Every citation must be a source you sent, not just any row `searchChunks` returned.

## The new case

Last week, Kettle & Co published version 3 of its refund policy with a typo: 3 days instead of 30. It rolled back to version 2 the same day. Version 3 is still in the table, `'stale'`, and nearer to the question than version 2.

Which chunks should the refund question find now? The check "leaves out a newer version the shop rolled back" adds version 3 inside a transaction, runs the search, and rolls the transaction back.

## Run the checks

You need the database for this one. See [Start](../README.md#start) in the README:

```sh
docker compose up -d --wait
npm run setup
npm run milestone -- 3
```

The search checks run your query on the real embeddings. Two of them add rows inside a transaction and roll it back, so the data stays the way `npm run setup` loaded it. The answer checks use a fake model, and rows recorded from the same data in `tests/fixtures/search-rows.json`:

- searches only the session's shop
- searches only the current version of each document
- leaves out a newer version the shop rolled back
- returns at most the limit, nearest first, with ties in id order
- hands a question with no chunk within 0.55 to a person, without a model call
- sends only the chunks within 0.55, at most 4, each with its id
- sends the instructions, the answer schema, a token limit, and the question in its tags
- rejects an answer with no citations, or one that cites a chunk that wasn't sent
- hands off a reply that isn't complete, isn't a JSON object, or says the sources don't answer

To try your query by hand, connect with `docker compose exec postgres psql -U postgres support`.

## Hints

Stuck? The hints go from where the course teaches this, to the approach, to details people often get wrong.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Vector search](https://atomicly.dev/lessons/ai-vector-search): section 1, *The nearest chunk belongs to another shop*, and section 2, *An old version is still in the table*. The end of section 3, *Pick a distance operator*, explains the ties.
- [RAG](https://atomicly.dev/lessons/ai-grounded-answers): section 1, *Give the model its sources, with their ids*, section 2, *No evidence, no model call*, and section 3, *Check the citations, and know what the check can't prove*.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `searchChunks`: do all of it in one query. Keep the session's shop, keep a chunk only when its version of the document is the current one, order by the distance and then the id, and stop at the limit. The current version is the one with the status `'current'`, which isn't always the highest number.
- `answerQuestion`: pick the sources first, and return before the call when there are none. After the call, check the status, then parse, then read the reply's own status, then check the citations against the sources.

</details>

<details>
<summary>Hint 3: details that are easy to get wrong</summary>

- Send the embedding as a query parameter, as `JSON.stringify(embedding)`, and cast it in the SQL with `::vector`. pg sends a JavaScript array as a PostgreSQL array, `{0.03,0.09,...}`, which pgvector can't read. pgvector reads `[0.03,0.09,...]`.
- Send the tenant id and the limit as query parameters too, such as `$1` and `$3`, never in the SQL text.
- Don't round the distance in SQL. pg turns a `numeric` into a string, so `round(...)::numeric` comes back as `'0.346'`.

</details>

## The solution

On the `solutions` branch, this milestone's code is in [`src/retrieval.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/retrieval.mjs).
