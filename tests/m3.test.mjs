// Milestone 3: retrieval. The search checks run against the project's PostgreSQL, with the real
// embeddings `npm run setup` loads. Two checks add made-up rows inside a transaction, and roll it
// back. The answer checks use rows recorded from the same data, and a fake model with made-up replies.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { connect, questionEmbedding } from "../src/lib/db.mjs";
import { fakeModel } from "../src/lib/fake-model.mjs";
import { ANSWER_FORMAT, ANSWER_INSTRUCTIONS, answerQuestion, checkCitations, HANDOFF, searchChunks } from "../src/retrieval.mjs";
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

// Each chunk's shop, and the chunks of stale versions.
let chunkInfo;
const chunks = () =>
  (chunkInfo ??= db().then(async (pg) => {
    const { rows } = await pg.query("SELECT c.id, c.tenant_id, d.status FROM chunks c JOIN documents d ON d.id = c.document_id AND d.version = c.version");
    return { shopOf: new Map(rows.map((row) => [row.id, row.tenant_id])), stale: new Set(rows.filter((row) => row.status !== "current").map((row) => row.id)) };
  }));

// Wraps a pool or a client, and records every row its queries return, so a check can see what left
// the database.
function recording(target) {
  const fetched = [];
  const wrapped = new Proxy(target, {
    get(object, key) {
      if (key === "query") {
        return async (...args) => {
          const result = await object.query(...args);
          if (Array.isArray(result?.rows)) fetched.push(...result.rows);
          return result;
        };
      }
      const value = object[key];
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  return { wrapped, fetched };
}

// Runs searchChunks with a question's stored embedding. `on` is a client in a transaction, or the pool.
async function search(session, questionId, limit, on) {
  const embedding = await questionEmbedding(await db(), questionId);
  const { wrapped, fetched } = recording(on ?? (await db()));
  let rows;
  try {
    rows = await searchChunks(wrapped, session, embedding, limit);
  } catch (error) {
    rethrowNotBuilt(error);
    if (/invalid input syntax for type vector/.test(error.message)) {
      assert.fail(
        `searchChunks threw PostgreSQL's error "invalid input syntax for type vector". pg sent the array of 256 numbers as a PostgreSQL array, such as {0.0348,0.0960,...}, and pgvector reads a vector only from text in square brackets, such as [0.0348,0.0960,...].`,
      );
    }
    const message = error.message.length > 200 ? `${error.message.slice(0, 200)}...` : error.message;
    assert.fail(`searchChunks threw "${message}" for ${session.tenantId} and the question ${questionId}.`);
  }
  return { rows, fetched, ids: Array.isArray(rows) ? rows.map((row) => row?.id) : rows };
}

// Runs `check(client)` inside a transaction that adds `sql`, then rolls it back.
async function withRows(sql, check) {
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    return await check(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

const complete = (reply) => ({ status: "complete", text: JSON.stringify(reply), usage: { input: 420, output: 40 } });
const sentText = (request) => (request?.messages ?? []).map((message) => message.content).join("\n");
const sentIds = (request) => [...sentText(request).matchAll(/<source id="([^"]+)">/g)].map((match) => match[1]);

async function answer(question, rows, model) {
  try {
    return await answerQuestion(question, rows, model);
  } catch (error) {
    rethrowNotBuilt(error);
    return `an error: ${error.message}`;
  }
}

test("searches only the session's shop", async () => {
  const { shopOf } = await chunks();
  const cases = [
    [kettle, "q-other-tenant", 'Can I send back an office chair after I\'ve put it together?", whose nearest chunk is Deskworks\'', "Kettle & Co's"],
    [deskworks, "q-gift-cards", 'How do gift cards work?", whose 7 nearest chunks are all Kettle & Co\'s', "Deskworks'"],
  ];
  for (const [session, questionId, question, shop] of cases) {
    const { ids, fetched } = await search(session, questionId, 5);
    const foreign = Array.isArray(ids) ? ids.filter((id) => shopOf.get(id) !== session.tenantId) : [];
    assert.ok(
      Array.isArray(ids) && foreign.length === 0,
      `searchChunks for a ${shop.replace(/'s?$/, "")} session returned ${show(ids)} for "${question}. It should return only ${shop} own chunks: the shop comes from session.tenantId.`,
    );
    const dropped = [...new Set(fetched.map((row) => row?.id).filter((id) => shopOf.has(id) && shopOf.get(id) !== session.tenantId))];
    assert.deepEqual(
      dropped,
      [],
      `searchChunks returned ${ids.length} of ${shop} chunks for "${question}, but its query fetched the other shop's ${dropped.join(", ")} first, and your code dropped them. Leave other shops' chunks out in the query itself, so another shop's text never leaves the database, and never takes one of the limit's places.`,
    );
    assert.equal(ids.length, 5, `searchChunks returned ${show(ids)} for "${question}, with a limit of 5. It should return 5 of ${shop} own chunks.`);
  }
  const forged = { tenantId: "kettleandco' OR 'x' = 'x", email: "chen.wei@example.com" };
  let rows;
  try {
    ({ rows } = await search(forged, "q-refund-window", 5));
  } catch (error) {
    rethrowNotBuilt(error);
    assert.fail(`${error.message.replace(/\.$/, "")}, for a tenant id with a quote in it. A value in the SQL text can change the query: send it to PostgreSQL as a query parameter.`);
  }
  assert.deepEqual(
    Array.isArray(rows) ? rows.map((row) => row?.id) : rows,
    [],
    `searchChunks returned rows for the tenant id ${show(forged.tenantId)}, which no shop has. A value in the SQL text can change the query: send it to PostgreSQL as a query parameter, so it finds nothing.`,
  );
});

test("searches only the current version of each document", async () => {
  const { stale } = await chunks();
  const { ids, fetched } = await search(kettle, "q-refund-window", 5);
  const old = Array.isArray(ids) ? ids.filter((id) => stale.has(id)) : [];
  assert.ok(
    Array.isArray(ids) && old.length === 0,
    `searchChunks returned ${show(ids)} for "How many days do I have to ask for a refund?". ${old[0] ?? "kc-refund-policy-v1-1"} comes from version 1 of the refund policy, which is stale and says 14 days. Only chunks of a document's current version count, and that's version 2.`,
  );
  const dropped = [...new Set(fetched.map((row) => row?.id).filter((id) => stale.has(id)))];
  assert.deepEqual(
    dropped,
    [],
    `searchChunks returned only current chunks, but its query fetched the old versions ${dropped.join(", ")} first, and your code dropped them. Leave old versions out in the query, so they never take one of the limit's places.`,
  );
  assert.equal(ids[0], "kc-refund-policy-v2-1", `searchChunks returned ${show(ids)}. The first row should be kc-refund-policy-v2-1, the current policy's nearest chunk.`);
});

test("leaves out a newer version the shop rolled back", async () => {
  // The new case: Kettle & Co published version 3 of its refund policy with a typo, 3 days instead of
  // 30, then rolled back to version 2. Version 3 stays in the table, stale, and nearer to the question.
  const rollback = `
    INSERT INTO documents (id, version, tenant_id, title, status) VALUES ('kc-refund-policy', 3, 'kettleandco', 'Refund policy', 'stale');
    INSERT INTO chunks (id, tenant_id, document_id, version, position, heading, content, model, embedding)
    SELECT 'kc-refund-policy-v3-1', 'kettleandco', 'kc-refund-policy', 3, 1, 'How long you have',
           'Refund policy, how long you have: You can ask for a refund within 3 days of delivery.', model,
           embedding + (SELECT embedding FROM questions WHERE id = 'q-refund-window')
    FROM chunks WHERE id = 'kc-refund-policy-v2-1';`;
  await withRows(rollback, async (client) => {
    const { ids, fetched } = await search(kettle, "q-refund-window", 3, client);
    assert.ok(
      Array.isArray(ids) && !ids.includes("kc-refund-policy-v3-1") && ids[0] === "kc-refund-policy-v2-1",
      `searchChunks returned ${show(ids)} after Kettle & Co rolled its refund policy back from version 3 to version 2. Version 3 is newer, and nearer to the question, but it's stale: the first row should be kc-refund-policy-v2-1, from the current version.`,
    );
    assert.ok(
      !fetched.some((row) => row?.id === "kc-refund-policy-v3-1"),
      "searchChunks returned only current chunks, but its query fetched kc-refund-policy-v3-1, the rolled-back version, and your code dropped it. Leave it out in the query, so it never takes one of the limit's places.",
    );
  });
});

test("returns at most the limit, nearest first, with ties in id order", async () => {
  const { shopOf, stale } = await chunks();
  const { rows, ids, fetched } = await search(kettle, "q-refund-window", 3);
  const expected = ["kc-refund-policy-v2-1", "kc-refund-policy-v2-2", "kc-warranty-v1-2"];
  if (Array.isArray(rows) && rows.length < 3) {
    const queried = [...new Set(fetched.map((row) => row?.id).filter((id) => shopOf.has(id)))];
    const dropped = queried.filter((id) => shopOf.get(id) !== "kettleandco" || stale.has(id));
    assert.fail(
      `searchChunks with a limit of 3 returned ${show(ids)}. ${dropped.length > 0 ? `Your query's 3 places went to ${queried.join(", ")}, and your code dropped ${dropped.join(", ")}, from another shop or an old version, after the limit. ` : ""}It should return 3 rows, ${expected.join(", ")}.`,
    );
  }
  assert.ok(Array.isArray(rows) && rows.length === 3, `searchChunks with a limit of 3 returned ${show(ids)}. It should return at most 3 rows: ${expected.join(", ")}.`);
  const [first] = rows;
  assert.deepEqual(Object.keys(first ?? {}).sort(), ["content", "distance", "id"], `Each row should have id, content, and distance, and nothing else. The first row was ${show(first)}.`);
  assert.equal(first.id, expected[0], `searchChunks returned ${show(ids)}. Nearest first, the first row should be ${expected[0]}.`);
  assert.ok(
    typeof first.distance === "number",
    `The first row's distance came back as ${show(first.distance)}, a ${typeof first.distance}. pg turns a numeric into a string, such as a distance rounded in SQL: it should be the cosine distance as a number.`,
  );
  assert.equal(first.distance.toFixed(3), "0.346", `The first row's distance was ${show(first.distance)}. It should be the cosine distance, 0.346 for ${expected[0]}.`);
  assert.deepEqual(ids, expected, `searchChunks returned ${show(ids)}, with the distances ${show(rows.map((row) => row.distance))}. Nearest first, it should return ${show(expected)}.`);

  // Kettle & Co's FAQ copies the refund policy's first paragraph word for word, so its chunk has the
  // same embedding, and the same distance.
  const copy = `
    INSERT INTO documents (id, version, tenant_id, title, status) VALUES ('kc-faq', 1, 'kettleandco', 'Questions we often get', 'current');
    INSERT INTO chunks (id, tenant_id, document_id, version, position, heading, content, model, embedding)
    SELECT 'kc-faq-v1-1', 'kettleandco', 'kc-faq', 1, 1, 'Refunds', content, model, embedding FROM chunks WHERE id = 'kc-refund-policy-v2-1';`;
  await withRows(copy, async (client) => {
    const tied = await search(kettle, "q-refund-window", 3, client);
    assert.deepEqual(
      tied.ids,
      ["kc-faq-v1-1", "kc-refund-policy-v2-1", "kc-refund-policy-v2-2"],
      `searchChunks returned ${show(tied.ids)} when kc-faq-v1-1 and kc-refund-policy-v2-1 are at the same distance. Two rows at one distance come back in id order, so every run returns the same rows in the same order: kc-faq-v1-1 first.`,
    );
  });
});

test("hands a question with no chunk within 0.55 to a person, without a model call", async () => {
  const { question, rows } = recorded["q-no-answer"]; // the nearest is kc-gift-cards-v1-2, at 0.698
  const model = fakeModel({ replies: [complete({ status: "answered", text: "Yes, we match any lower price.", citations: ["kc-gift-cards-v1-2"] })] });
  const result = await answer(question, rows, model);
  assert.equal(
    model.requests.length,
    0,
    `answerQuestion called the model ${model.requests.length} time(s) for "${question}", whose nearest chunk is at 0.698. With no source left, there's nothing to answer from: don't call the model.`,
  );
  const expected = { status: "insufficient", text: HANDOFF, reason: "no sources" };
  assert.deepEqual(result, expected, `answerQuestion returned ${show(result)}. It should hand off: ${show(expected)}.`);
});

test("sends only the chunks within 0.55, at most 4, each with its id", async () => {
  const { question, rows } = recorded["q-dw-desk-lamp"]; // 4 rows within 0.55, then dw-shipping-v1-1 at 0.553
  const reply = { status: "answered", text: "You have 60 days from delivery, if the lamp can be sold again.", citations: ["dw-refund-policy-v1-1"] };
  const model = fakeModel({ replies: [complete(reply)] });
  const result = await answer(question, rows, model);
  const within = ["dw-refund-policy-v1-1", "dw-assembled-furniture-v1-1", "dw-assembled-furniture-v1-2", "dw-refund-policy-v1-2"];
  assert.deepEqual(
    sentIds(model.requests[0]),
    within,
    `The request's messages held the sources ${show(sentIds(model.requests[0]))}. They should hold the 4 rows within 0.55, each in a <source id="..."> tag from evidenceBlock, and not dw-shipping-v1-1, at 0.553.`,
  );
  assert.deepEqual(result, { status: "answered", ...reply }, `answerQuestion returned ${show(result)} for a valid reply. It should return ${show({ status: "answered", ...reply })}.`);

  // Made-up distances: six chunks, all within 0.55, the last one at exactly 0.55
  const close = Array.from({ length: 6 }, (_, i) => ({ id: `dw-chunk-${i + 1}`, content: `Text ${i + 1}`, distance: 0.3 + i * 0.05 }));
  const second = fakeModel({ replies: [complete({ status: "insufficient", text: "", citations: [] })] });
  await answer(question, close, second);
  assert.deepEqual(
    sentIds(second.requests[0]),
    ["dw-chunk-1", "dw-chunk-2", "dw-chunk-3", "dw-chunk-4"],
    `answerQuestion sent the sources ${show(sentIds(second.requests[0]))} when 6 rows were within 0.55. Send the nearest MAX_SOURCES, 4, so the request stays small.`,
  );
  const edge = fakeModel({ replies: [complete({ status: "insufficient", text: "", citations: [] })] });
  await answer(question, [{ id: "dw-shipping-v1-1", content: "Deskworks ships within 2 business days.", distance: 0.55 }], edge);
  assert.deepEqual(sentIds(edge.requests[0]), ["dw-shipping-v1-1"], `answerQuestion sent ${show(sentIds(edge.requests[0]))} for one row at exactly 0.55. A row at a distance of at most MAX_DISTANCE is a source.`);
});

test("sends the instructions, the answer schema, a token limit, and the question in its tags", async () => {
  const { question, rows } = recorded["q-refund-window"];
  const model = fakeModel({ replies: [complete({ status: "insufficient", text: "", citations: [] })] });
  await answer(question, rows, model);
  const [request] = model.requests;
  const messages = request?.messages ?? [];
  assert.deepEqual(
    messages[0],
    { role: "developer", content: ANSWER_INSTRUCTIONS },
    `The request's first message was ${show(messages[0])}. It should be a developer message with ANSWER_INSTRUCTIONS, and nothing else, so the sources stay apart from your instructions.`,
  );
  const user = messages.find((message) => message.role === "user")?.content ?? "";
  const tagged = new RegExp(`<question>\\s*${question.replace(/[?.]/g, "\\$&")}\\s*</question>`).test(user);
  assert.ok(
    user.includes('<source id="kc-refund-policy-v2-1">') && tagged,
    `The request's user message was ${show(user)}. It should hold the sources in their <source> tags, and the question between <question> and </question>.`,
  );
  assert.deepEqual(request.response_format, ANSWER_FORMAT, `The request's response_format was ${show(request.response_format)}. Send ANSWER_FORMAT, so the reply matches its schema.`);
  assert.equal(request.max_completion_tokens, 400, `The request's max_completion_tokens was ${show(request.max_completion_tokens)}. It should be 400: milestone 6 prices a call's worst case from it.`);
});

test("rejects an answer with no citations, or one that cites a chunk that wasn't sent", async () => {
  const sources = [{ id: "kc-warranty-v1-1" }, { id: "kc-warranty-v1-2" }];
  const uncited = checkCitations({ status: "answered", text: "The warranty lasts 2 years.", citations: [] }, sources);
  assert.ok(
    uncited?.ok === false && typeof uncited.reason === "string" && uncited.reason.trim() !== "",
    `checkCitations returned ${show(uncited)} for an answered reply with no citations. An answer needs at least one source behind it: it should return { ok: false, reason }, with any reason you like.`,
  );
  const cases = [
    [
      { status: "answered", text: "2 years, or 3 with registration.", citations: ["kc-warranty-v1-2", "kc-warranty-v2-1", "kc-returns-v1-3"] },
      { ok: false, reason: "cited chunks that weren't sent: kc-warranty-v2-1, kc-returns-v1-3" },
      "an answer citing two ids that weren't sent, with every unknown id in the order of the citations",
    ],
    [{ status: "answered", text: "The warranty lasts 2 years.", citations: ["kc-warranty-v1-1", "kc-warranty-v1-2"] }, { ok: true }, "an answer that cites only sources"],
    [{ status: "insufficient", text: "", citations: [] }, { ok: true }, 'a reply with the status "insufficient", which claims nothing'],
  ];
  for (const [reply, expected, label] of cases) {
    const check = checkCitations(reply, sources);
    assert.deepEqual(check, expected, `checkCitations returned ${show(check)} for ${label}. It should return ${show(expected)}.`);
  }

  const { question, rows } = recorded["q-refund-window"]; // kc-gift-cards-v1-3 is a row, at 0.593, but not a source
  const model = fakeModel({ replies: [complete({ status: "answered", text: "Gift cards can't be refunded.", citations: ["kc-gift-cards-v1-3"] })] });
  const result = await answer(question, rows, model);
  assert.deepEqual(
    result,
    { status: "insufficient", text: HANDOFF, reason: "cited chunks that weren't sent: kc-gift-cards-v1-3" },
    `answerQuestion returned ${show(result)} for a reply that cites kc-gift-cards-v1-3, a row at 0.593 that wasn't in the request. Check the citations against the sources: it should hand off, with checkCitations' reason.`,
  );
});

test("hands off a reply that isn't complete, isn't a JSON object, or says the sources don't answer", async () => {
  const { question, rows } = recorded["q-refund-window"];
  const usage = { input: 420, output: 9 };
  const replies = [
    [{ status: "refused", text: null, usage }, "refused", "Only a complete reply gets parsed, so it should hand off with the status"],
    [{ status: "cut_off", text: '{"status":"answered","text":"You have 30 days from', usage: { input: 420, output: 400 } }, "cut_off", "Only a complete reply gets parsed, so it should hand off with the status"],
    [{ status: "complete", text: "You have 30 days from delivery.", usage }, "invalid JSON", "It should hand off when the text isn't JSON"],
    [{ status: "complete", text: "null", usage }, "invalid JSON", "null is JSON, but not an answer: it should hand off as invalid JSON"],
    [complete({ status: "insufficient", text: "", citations: [] }), "insufficient", 'It should hand off when the reply\'s own status is "insufficient"'],
  ];
  for (const [reply, reason, why] of replies) {
    const result = await answer(question, rows, fakeModel({ replies: [reply] }));
    const expected = { status: "insufficient", text: HANDOFF, reason };
    assert.deepEqual(result, expected, `answerQuestion returned ${show(result)} for a ${reply.status} reply with the text ${show(reply.text)}. ${why}: ${show(expected)}.`);
  }
});
