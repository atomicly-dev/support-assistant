// Milestone 3: retrieval. The search checks run against the project's PostgreSQL, with the real
// embeddings `npm run setup` loads. The answer checks use rows recorded from the same data, and a
// fake model with made-up replies.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { connect, questionEmbedding } from "../src/lib/db.mjs";
import { fakeModel } from "../src/lib/fake-model.mjs";
import { answerQuestion, checkCitations, HANDOFF, searchChunks } from "../src/retrieval.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

const recorded = JSON.parse(readFileSync(new URL("fixtures/search-rows.json", import.meta.url), "utf8")).questions;
const kettle = { tenantId: "kettleandco", email: "chen.wei@example.com" };
const deskworks = { tenantId: "deskworks", email: "pia.lund@example.com" };

// One pool for the file, opened by the first check that needs it.
let pool;
const db = () => (pool ??= connect());
after(async () => {
  const opened = await pool?.catch(() => null);
  await opened?.end();
});

async function search(session, questionId, limit) {
  const embedding = await questionEmbedding(await db(), questionId);
  return searchChunks(await db(), session, embedding, limit);
}
const ids = (rows) => (Array.isArray(rows) ? rows.map((row) => row.id) : rows);
const complete = (reply) => ({ status: "complete", text: JSON.stringify(reply), usage: { input: 420, output: 40 } });

test("searches only the session's shop", async () => {
  // Without a filter, the nearest chunk to the office chair question is Deskworks' dw-assembled-furniture-v1-1.
  const kettleRows = await search(kettle, "q-other-tenant", 5);
  const leaked = ids(kettleRows).filter((id) => !id.startsWith("kc-"));
  assert.ok(
    Array.isArray(kettleRows) && kettleRows.length > 0 && leaked.length === 0,
    `searchChunks for a Kettle & Co session returned ${show(ids(kettleRows))} for "Can I send back an office chair after I've put it together?". The shop filter goes in the query's WHERE, so it should return only Kettle & Co's chunks, the ids that start with kc-.`,
  );
  const deskRows = await search(deskworks, "q-dw-desk-lamp", 5);
  const leakedDesk = ids(deskRows).filter((id) => !id.startsWith("dw-"));
  assert.ok(
    Array.isArray(deskRows) && deskRows.length > 0 && leakedDesk.length === 0,
    `searchChunks for a Deskworks session returned ${show(ids(deskRows))}. It should return only Deskworks' chunks, the ids that start with dw-, from the session's tenantId.`,
  );
});

test("searches only the current version of each document", async () => {
  const rows = await search(kettle, "q-refund-window", 5);
  const stale = ids(rows).filter((id) => id.startsWith("kc-refund-policy-v1-"));
  assert.ok(
    Array.isArray(rows) && stale.length === 0 && rows[0]?.id === "kc-refund-policy-v2-1",
    `searchChunks returned ${show(ids(rows))} for "How many days do I have to ask for a refund?". Version 1 of the refund policy is stale and says 14 days. Join documents and keep status 'current': the first row should be kc-refund-policy-v2-1.`,
  );
});

test("returns at most the limit, nearest first, with each row's id, content, and distance", async () => {
  const rows = await search(kettle, "q-refund-window", 3);
  assert.ok(Array.isArray(rows) && rows.length === 3, `searchChunks with a limit of 3 returned ${show(ids(rows))}. It should return 3 rows.`);
  const [first] = rows;
  assert.deepEqual(
    Object.keys(first).sort(),
    ["content", "distance", "id"],
    `Each row should have id, content, and distance. The first row was ${show(first)}.`,
  );
  assert.ok(
    typeof first.distance === "number" && first.distance.toFixed(3) === "0.346",
    `The first row's distance was ${show(first.distance)}. It should be the cosine distance <=>, a number: 0.346 for kc-refund-policy-v2-1.`,
  );
  const distances = rows.map((row) => row.distance);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b), `The rows' distances came back as ${show(distances)}. Order by distance, nearest first.`);
});

test("hands a question with no chunk within 0.55 to a person, without a model call", async () => {
  const { question, rows } = recorded["q-no-answer"]; // the nearest is kc-gift-cards-v1-2, at 0.698
  const model = fakeModel({ replies: [complete({ status: "answered", text: "Yes, we match any lower price.", citations: ["kc-gift-cards-v1-2"] })] });
  const answer = await answerQuestion(question, rows, model);
  assert.equal(
    model.requests.length,
    0,
    `answerQuestion called the model ${model.requests.length} time(s) for "${question}", whose nearest chunk is at 0.698. With no source left, there's nothing to answer from: make no call.`,
  );
  const expected = { status: "insufficient", text: HANDOFF, reason: "no sources" };
  assert.deepEqual(answer, expected, `answerQuestion returned ${show(answer)}. It should hand off: ${show(expected)}.`);
});

test("sends only the chunks within 0.55, at most 4, each with its id", async () => {
  const { question, rows } = recorded["q-dw-desk-lamp"]; // 4 rows within 0.55, then dw-shipping-v1-1 at 0.553
  const reply = { status: "answered", text: "You have 60 days from delivery, if the lamp can be sold again.", citations: ["dw-refund-policy-v1-1"] };
  const model = fakeModel({ replies: [complete(reply)] });
  const answer = await answerQuestion(question, rows, model);
  const request = model.requests[0];
  const sent = (request?.messages ?? []).map((message) => message.content).join("\n");
  const tagged = [...sent.matchAll(/<source id="([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(
    tagged,
    ["dw-refund-policy-v1-1", "dw-assembled-furniture-v1-1", "dw-assembled-furniture-v1-2", "dw-refund-policy-v1-2"],
    `The request's messages held the sources ${show(tagged)}. They should hold the 4 rows within 0.55, each in a <source id="..."> tag from evidenceBlock, and not dw-shipping-v1-1, at 0.553.`,
  );
  assert.ok(sent.includes(question), `The request's messages don't include the question "${question}".`);
  assert.deepEqual(answer, { status: "answered", ...reply }, `answerQuestion returned ${show(answer)} for a valid reply. It should return ${show({ status: "answered", ...reply })}.`);

  // Made-up distances: six chunks, all within 0.55
  const close = Array.from({ length: 6 }, (_, i) => ({ id: `dw-chunk-${i + 1}`, content: `Text ${i + 1}`, distance: 0.3 + i * 0.02 }));
  const second = fakeModel({ replies: [complete({ status: "insufficient", text: "", citations: [] })] });
  await answerQuestion(question, close, second);
  const secondSent = (second.requests[0]?.messages ?? []).map((message) => message.content).join("\n");
  const count = (secondSent.match(/<source id=/g) ?? []).length;
  assert.equal(count, 4, `answerQuestion sent ${count} sources when 6 rows were within 0.55. Send at most MAX_SOURCES, 4, so the request stays small.`);
});

test("rejects an answer that cites a chunk that wasn't sent", async () => {
  const sources = [{ id: "kc-refund-policy-v2-1" }, { id: "kc-refund-policy-v2-2" }];
  const cited = { status: "answered", text: "14 days, or store credit.", citations: ["kc-refund-policy-v1-1", "kc-refund-policy-v2-1", "kc-gift-cards-v1-3"] };
  const check = checkCitations(cited, sources);
  const expected = { ok: false, reason: "cited chunks that weren't sent: kc-refund-policy-v1-1, kc-gift-cards-v1-3" };
  assert.deepEqual(check, expected, `checkCitations returned ${show(check)} for an answer citing two ids that weren't sent. It should return ${show(expected)}, with every unknown id in the order of the citations.`);

  const { question, rows } = recorded["q-refund-window"];
  const model = fakeModel({ replies: [complete({ status: "answered", text: "You have 14 days from delivery.", citations: ["kc-refund-policy-v1-1"] })] });
  const answer = await answerQuestion(question, rows, model);
  assert.deepEqual(
    answer,
    { status: "insufficient", text: HANDOFF, reason: "cited chunks that weren't sent: kc-refund-policy-v1-1" },
    `answerQuestion returned ${show(answer)} for a reply that cites the old refund policy, which the search never returned. It should hand off, with checkCitations' reason.`,
  );
});

test("hands off a refused or cut-off reply without parsing it", async () => {
  const { question, rows } = recorded["q-refund-window"];
  const replies = [
    { status: "refused", text: null, usage: { input: 420, output: 9 } },
    { status: "cut_off", text: '{"status":"answered","text":"You have 30 days from', usage: { input: 420, output: 400 } },
  ];
  for (const reply of replies) {
    let answer;
    try {
      answer = await answerQuestion(question, rows, fakeModel({ replies: [reply] }));
    } catch (error) {
      rethrowNotBuilt(error);
      assert.fail(`answerQuestion threw "${error.message}" for a ${reply.status} reply. Check the status before you parse.`);
    }
    const expected = { status: "insufficient", text: HANDOFF, reason: reply.status };
    assert.deepEqual(answer, expected, `answerQuestion returned ${show(answer)} for a ${reply.status} reply. It should hand off: ${show(expected)}.`);
  }
});
