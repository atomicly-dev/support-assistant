# Milestone 3: Retrieval

Read this on atomicly, with the tutor beside it: [milestone 3 on atomicly](https://atomicly.dev/projects/proj-support-assistant/milestones/proj-support-m3).

Lessons: [Embeddings: what a vector lets you compare](https://atomicly.dev/lessons/ai-embeddings), [Vector search: find the nearest authorized chunks](https://atomicly.dev/lessons/ai-vector-search), and [RAG: ground the answer in retrieved chunks](https://atomicly.dev/lessons/ai-grounded-answers)

## The situation

A Kettle & Co customer asks "How many days do I have to ask for a refund?". The help center holds both shops' pages in one `chunks` table, each chunk with a real embedding. Order them all by cosine distance, and the nearest chunk is Deskworks' refund policy, which gives 60 days. The next one is Kettle & Co's old policy, version 1, which gives 14. Kettle & Co's current answer, 30 days, comes third.

And when the assistant did find the right chunk, the model once cited a chunk the search never returned.

## What you build

All three functions go in `src/retrieval.mjs`. The file already has `MAX_DISTANCE` (0.55), `MAX_SOURCES` (4), `HANDOFF`, `ANSWER_INSTRUCTIONS`, `ANSWER_FORMAT`, and `evidenceBlock(sources)`.

**`searchChunks(db, session, embedding, limit = 5)`** finds the chunks nearest to a question's embedding:

- `db` is a pg Pool from `src/lib/db.mjs`. `await db.query(sql, values)` resolves to `{ rows }`.
- `session` is `{ tenantId, ... }`, from the customer's login.
- `embedding` is an array of 256 numbers.

It resolves to at most `limit` rows `{ id, content, distance }`, where `distance` is the cosine distance, as a number. The tables are in `data/ai-support.sql`. Each chunk has its shop's `tenant_id`, its document's `document_id`, and the `version` of the document it comes from. Each version of a document has a `status`, `'current'` or `'stale'`.

**`checkCitations(answer, sources)`** checks a reply's citations against the sources the request sent. `answer` is the model's parsed reply, `{ status, text, citations }`, and `sources` are rows like `searchChunks`' rows:

| The reply | It returns |
| --- | --- |
| `status` is `"insufficient"` | `{ ok: true }` |
| it cites only the sources' ids | `{ ok: true }` |
| it cites nothing | `{ ok: false, reason }`, with a reason you choose |
| it cites ids that weren't sent | `{ ok: false, reason: "cited chunks that weren't sent: <ids>" }` |

`<ids>` is every unknown id, in the order of the citations, joined with `, `.

**`answerQuestion(question, rows, model)`** answers from the rows `searchChunks` returned, nearest first, with one `model.complete(request)` call at most. `model.complete` resolves to a result like milestone 1's, `{ status, text, usage }`. A complete reply's text is JSON for `ANSWER_FORMAT`: `{ status, text, citations }`. The request holds:

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

- `searchChunks` finds only the session's shop's chunks, and only chunks of each document's current version.
- Another shop's chunk or an old version never comes back from the database, so neither takes one of the `limit` places.
- The rows come nearest first. Two rows at the same distance come in id order, so every run returns the same rows.
- A tenant id no shop has finds nothing, even one with a quote in it, such as `kettleandco' OR 'x' = 'x`.
- The sources are the nearest rows with a distance of at most `MAX_DISTANCE`, and at most `MAX_SOURCES` of them. With none, `answerQuestion` hands off without a model call.
- Only a complete result gets parsed.
- Every citation is a source the request sent, not just any row.

## The new case

Last week, Kettle & Co published version 3 of its refund policy with a typo: 3 days instead of 30. It rolled back to version 2 the same day. Version 3 is still in the table, `'stale'`, and nearer to the question than version 2.

Which chunks should the refund question find now? The check **leaves out a newer version the shop rolled back** adds version 3 in a transaction, searches, and rolls it back.

## Run the checks

This milestone needs the database. See [Start](../README.md#start) in the README:

```sh
docker compose up -d --wait
npm run setup
npm run milestone -- 3
```

The search checks run your query against the real embeddings. Two of them add rows in a transaction and roll it back, so the data stays as `npm run setup` loaded it. The answer checks use rows recorded from the same data, in `tests/fixtures/search-rows.json`, and a fake model:

- searches only the session's shop
- searches only the current version of each document
- leaves out a newer version the shop rolled back
- returns at most the limit, nearest first, with ties in id order
- hands a question with no chunk within 0.55 to a person, without a model call
- sends only the chunks within 0.55, at most 4, each with its id
- asks with the instructions, the answer schema, a token limit, and the question in its tags
- rejects an answer with no citations, or one that cites a chunk that wasn't sent
- hands off a reply that isn't complete, isn't a JSON object, or says the sources don't answer

To try your query by hand, connect with `docker compose exec postgres psql -U postgres support`.

## Hints

Each hint gives away a bit more. Open only the one you need.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Vector search](https://atomicly.dev/lessons/ai-vector-search): section 1, *The nearest chunk belongs to another shop*, and section 2, *An old version is still in the table*. The end of section 3, *Pick a distance operator*, explains the ties.
- [RAG](https://atomicly.dev/lessons/ai-grounded-answers): section 1, *Give the model its sources, with their ids*, section 2, *No evidence, no model call*, and section 3, *Check the citations, and know what the check can't prove*.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `searchChunks`: one query does all of it. It keeps the session's shop, keeps each chunk only when its own version of the document is the current one, orders by the distance and then the id, and stops at the limit. The current version is the one whose status is `'current'`, which isn't always the highest number.
- `answerQuestion`: pick the sources first, and return before the call when none is left. After the call, check the status, then parse, then read the reply's own status, then check the citations against the sources.

</details>

<details>
<summary>Hint 3: details that are easy to get wrong</summary>

- Send the embedding as a query parameter, as `JSON.stringify(embedding)`, and cast it in the SQL with `::vector`. pg sends a JavaScript array as a PostgreSQL array, `{0.03,0.09,...}`, which pgvector can't read. pgvector reads `[0.03,0.09,...]`.
- Send the tenant id and the limit as query parameters too, such as `$1` and `$3`, never in the SQL text.
- Don't round the distance in SQL. pg turns a `numeric` into a string, so `round(...)::numeric` comes back as `'0.346'`.

</details>

## The solution

The `solutions` branch has every milestone built. This one is in [`src/retrieval.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/retrieval.mjs).
