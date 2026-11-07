# Milestone 3: Retrieval

Lessons: [Embeddings: what a vector lets you compare](https://atomicly.dev/lessons/ai-embeddings), [Vector search: find the nearest authorized chunks](https://atomicly.dev/lessons/ai-vector-search), and [RAG: ground the answer in retrieved chunks](https://atomicly.dev/lessons/ai-grounded-answers)

## The situation

A Kettle & Co customer asks "How many days do I have to ask for a refund?". The help center holds both shops' pages in one `chunks` table, each chunk with a real embedding. Order them all by cosine distance, and the nearest chunk is Deskworks' refund policy, which gives 60 days. The next one is Kettle & Co's old policy, version 1, which gives 14. Kettle & Co's current answer, 30 days, comes third.

And when the assistant did find the right chunk, the model once cited a chunk the search never returned.

## What you build

All three functions go in `src/retrieval.mjs`.

**`searchChunks(db, session, embedding, limit = 5)`** finds the chunks nearest to a question's embedding. `db` is a pg Pool from `src/lib/db.mjs`, `session` is `{ tenantId, ... }`, and `embedding` is an array of 256 numbers. It resolves to at most `limit` rows `{ id, content, distance }`:

- only chunks with the session's `tenant_id`, filtered in the query's `WHERE`, so the filter runs before `LIMIT`
- only chunks of a document's current version: join `documents` on the id and the version, and keep `status = 'current'`
- `distance` is the cosine distance, pgvector's `<=>`, and the rows are nearest first, with `id` breaking ties

Pass the embedding as a query parameter, cast with `::vector`. pgvector reads a vector from text such as `[0.1,0.2,0.3]`, which is what `JSON.stringify(embedding)` gives you. The tables are in `data/ai-support.sql`.

**`checkCitations(answer, sources)`** checks an answer's citations against the sources the request sent. It returns `{ ok: true }` for a reply whose `status` is `"insufficient"`, or for one whose citations are all among the sources' ids. Otherwise it returns `{ ok: false, reason }`:

- `"no citations"` for an answered reply with an empty `citations` list
- `` `cited chunks that weren't sent: ${ids}` `` with every unknown id, in the order of the citations, joined with `, `

**`answerQuestion(question, rows, model)`** answers from the rows `searchChunks` returned, with one `model.complete` call at most:

1. Keep the rows with a `distance` of at most `MAX_DISTANCE`, 0.55, and at most `MAX_SOURCES`, 4, of them. These are the sources.
2. With no source left, hand off, and don't call the model.
3. Call `model.complete` with a developer message, `ANSWER_INSTRUCTIONS`, and a user message with `evidenceBlock(sources)` and the question in `<question>` tags. Send `response_format: ANSWER_FORMAT` and `max_completion_tokens: 400`.
4. Parse only a `"complete"` result. Its JSON is `{ status, text, citations }`. Check the citations with `checkCitations`.

It resolves to `{ status: "answered", text, citations }`, or to `{ status: "insufficient", text: HANDOFF, reason }` when a person should answer instead. The reason is `"no sources"`, the result's status for a reply that isn't complete, `"invalid JSON"`, `"insufficient"` when the model says the sources don't answer it, or `checkCitations`' reason.

The file already has `MAX_DISTANCE`, `MAX_SOURCES`, `HANDOFF`, `ANSWER_INSTRUCTIONS`, `ANSWER_FORMAT`, and `evidenceBlock`.

## Run the checks

This milestone needs the database:

```sh
docker compose up -d --wait
npm run setup
npm run milestone -- 3
```

The search checks run your query against the real embeddings. The answer checks use rows recorded from the same data, in `tests/fixtures/search-rows.json`, and a fake model:

- searches only the session's shop
- searches only the current version of each document
- returns at most the limit, nearest first, with each row's id, content, and distance
- hands a question with no chunk within 0.55 to a person, without a model call
- sends only the chunks within 0.55, at most 4, each with its id
- rejects an answer that cites a chunk that wasn't sent
- hands off a refused or cut-off reply without parsing it

To try your query by hand, connect with `docker compose exec postgres psql -U postgres support`.

## Hints

- Sections 1 and 2 of [Vector search](https://atomicly.dev/lessons/ai-vector-search), *The nearest chunk belongs to another shop* and *An old version is still in the table*, write this query in SQL. Take the tenant from `session.tenantId`, never from the question.
- Section 2 of [RAG](https://atomicly.dev/lessons/ai-grounded-answers), *No evidence, no model call*, writes `answerQuestion`, and section 3, *Check the citations*, writes the citation check. It also says what the check can't prove: a citation of the right chunk with the wrong number still passes. Milestone 4's answer eval catches that.

## The solution

The `solutions` branch has every milestone built. This one is in [`src/retrieval.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/retrieval.mjs).
