// Milestone 2: streaming and tools. The events and tool calls are made-up examples, not recorded
// ones. The orders are the dataset's, from data/orders.json, plus one made-up Deskworks order.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ORDERS, orderLookup } from "../src/lib/orders.mjs";
import { readStream } from "../src/stream.mjs";
import { getOrder, runToolCall } from "../src/tools.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

// The events arrive one turn of the event loop apart, like a real stream.
async function* stream(events) {
  for (const event of events) {
    await new Promise((resolve) => setImmediate(resolve));
    yield event;
  }
}

async function read(events, label) {
  try {
    return await readStream(stream(events));
  } catch (error) {
    rethrowNotBuilt(error);
    assert.fail(`readStream threw "${error.message}" for ${label}.`);
  }
}

const text = (value) => ({ type: "text", text: value });
const finish = (status) => ({ type: "finish", status });
// Ana Silva placed orders 1040 and 1048 at Kettle & Co. Chen Wei placed order 1042 there.
const ana = { tenantId: "kettleandco", email: "ana.silva@example.com" };
// The new case: Ana also buys from Deskworks, with the same email. Order 2010 is made up for it.
const anaAtDeskworks = { tenantId: "deskworks", email: "ana.silva@example.com" };
const findOrder = orderLookup([
  ...ORDERS,
  { id: 2010, tenantId: "deskworks", email: "ana.silva@example.com", status: "paid", totalCents: 18900, orderedOn: "2026-11-02" },
]);

test("takes the status only from a finish event, so a dropped stream stays interrupted", async () => {
  const dropped = await read([text("Your order 1048 "), text("left our warehouse on")], "a stream that ended without a finish event"); // the connection drops
  assert.equal(
    dropped?.status,
    "interrupted",
    `readStream returned ${show(dropped)} for a stream that ended without a finish event. The end of a stream only means no more data is coming: the status should stay "interrupted".`,
  );
  assert.equal(dropped.text, "Your order 1048 left our warehouse on", `readStream's text was ${show(dropped.text)}. It should keep the text it got: "Your order 1048 left our warehouse on".`);

  for (const status of ["complete", "cut_off", "refused"]) {
    const answer = await read([text("Your order 1048 shipped"), finish(status)], `a stream that finished with status "${status}"`);
    assert.equal(answer?.status, status, `readStream returned ${show(answer)} for a stream whose finish event says "${status}". The status should be the finish event's, "${status}".`);
  }
});

test("keeps the usage unknown when the stream ends before its usage event", async () => {
  const withUsage = await read([text("Order 1048 shipped."), finish("complete"), { type: "usage", input: 318, output: 9 }], "a stream with a usage event");
  assert.deepEqual(withUsage?.usage, { input: 318, output: 9 }, `readStream's usage was ${show(withUsage?.usage)} for a stream with a usage event. It should be { input: 318, output: 9 }.`);

  const withoutUsage = await read([text("Order 1048 shipped."), finish("complete")], "a stream without a usage event"); // it drops before the usage
  assert.equal(
    withoutUsage?.usage,
    null,
    `readStream's usage was ${show(withoutUsage?.usage)} for a complete answer whose usage event never arrived. Usage is unknown, not zero tokens: it should stay null.`,
  );
});

test("stops at an error event, and skips event types it doesn't handle", async () => {
  const events = [text("Your order 1048"), { type: "keepalive" }, text(" left on"), { type: "error", message: "Rate limit reached" }, text(" October 30."), finish("complete")];
  const answer = await read(events, "a stream with a keepalive event. Skip the event types you don't handle");
  const expected = { status: "failed", text: "Your order 1048 left on", usage: null, error: "Rate limit reached" };
  assert.deepEqual(
    answer,
    expected,
    `readStream returned ${show(answer)} for text, a keepalive, more text, an error, then more text and a finish. The error ends the answer, and nothing after it counts: it should return ${show(expected)}.`,
  );
});

test("ends the text at the finish event, and still reads the usage after it", async () => {
  // The new case: a gateway between the assistant and the provider resends the last piece of text
  // after the finish event, when it retries a slow connection.
  const events = [text("Your order 1048 left our warehouse on October 30."), finish("complete"), text(" October 30."), { type: "usage", input: 318, output: 14 }];
  const answer = await read(events, "a stream with text after its finish event");
  const expected = { status: "complete", text: "Your order 1048 left our warehouse on October 30.", usage: { input: 318, output: 14 }, error: null };
  assert.deepEqual(
    answer,
    expected,
    `readStream returned ${show(answer)} for text, a finish, the same text again from the gateway, then the usage. The finish event ends the answer: text after it isn't part of the answer, but the usage that comes after it is. It should return ${show(expected)}.`,
  );
});

test("looks up the session customer's own order, with only the fields the answer needs", async () => {
  const result = await getOrder({ orderId: 1048 }, ana, findOrder);
  const expected = { id: 1048, status: "shipped", totalCents: 5600, orderedOn: "2026-10-29" };
  assert.deepEqual(
    result,
    expected,
    `getOrder({ orderId: 1048 }) for Ana returned ${show(result)}. The customer can read whatever a tool returns, so it should return only ${show(expected)}.`,
  );
});

test("answers another customer's order and a missing one the same way, whatever the arguments say", async () => {
  const cases = [
    ["Chen's order 1042", { orderId: 1042 }],
    ["Chen's order 1042, with Chen's email and shop in the arguments", { orderId: 1042, email: "chen.wei@example.com", tenantId: "kettleandco" }],
    ["order 9999, which doesn't exist", { orderId: 9999 }],
  ];
  for (const [label, args] of cases) {
    const result = await getOrder(args, ana, findOrder);
    assert.deepEqual(
      result,
      { error: "order not found" },
      `getOrder returned ${show(result)} for ${label}, in Ana's session. The customer comes from the session, never from the arguments, and every order that isn't theirs gets the same answer: { error: 'order not found' }.`,
    );
  }
});

test("keeps one email's orders apart in each shop", async () => {
  const own = await getOrder({ orderId: 2010 }, anaAtDeskworks, findOrder);
  const fields = { id: 2010, status: "paid", totalCents: 18900, orderedOn: "2026-11-02" };
  assert.deepEqual(
    own,
    fields,
    `getOrder returned ${show(own)} for order 2010, Ana's Deskworks order, in her Deskworks session. It's her order in that shop, so it should return ${show(fields)}.`,
  );
  const cases = [
    ["order 1048, Ana's Kettle & Co order, in her Deskworks session", { orderId: 1048 }, anaAtDeskworks],
    ["order 2010, Ana's Deskworks order, in her Kettle & Co session", { orderId: 2010 }, ana],
  ];
  for (const [label, args, session] of cases) {
    const result = await getOrder(args, session, findOrder);
    assert.deepEqual(
      result,
      { error: "order not found" },
      `getOrder returned ${show(result)} for ${label}. A customer is an email in one shop, so each session sees only that shop's orders: it should return { error: 'order not found' }.`,
    );
  }
});

test("runs only the tools on its list", async () => {
  let ran = 0;
  const tools = new Map([
    [
      "get_order",
      () => {
        ran++;
        return { id: 1048, status: "shipped" };
      },
    ],
  ]);
  for (const name of ["cancel_order", "constructor"]) {
    const call = { id: "call_X1", type: "function", function: { name, arguments: '{"orderId":1048}' } };
    let message;
    try {
      message = await runToolCall(call, ana, tools, () => {});
    } catch (error) {
      rethrowNotBuilt(error);
      assert.fail(`runToolCall threw "${error.message}" for a call to ${name}. A call to a tool that isn't on the list should get an error the model can read.`);
    }
    assert.equal(
      message?.content,
      JSON.stringify({ error: `unknown tool: ${name}` }),
      `runToolCall answered a call to ${name} with ${show(message)}. Only the tools in the Map can run, so its content should be '{"error":"unknown tool: ${name}"}'.`,
    );
  }
  assert.equal(ran, 0, `The get_order tool ran ${ran} times for calls to other tools. It shouldn't run at all.`);
});

test("passes the tool the session from the login, whatever the arguments say", async () => {
  const seen = [];
  const tools = new Map([["get_order", (args, session) => (seen.push(session), { error: "order not found" })]]);
  const call = { id: "call_S1", type: "function", function: { name: "get_order", arguments: '{"orderId":1042,"email":"chen.wei@example.com","tenantId":"kettleandco"}' } };
  try {
    await runToolCall(call, ana, tools, () => {});
  } catch (error) {
    rethrowNotBuilt(error);
    assert.fail(`runToolCall threw "${error.message}" for a call whose arguments name Chen's email.`);
  }
  assert.deepEqual(
    seen,
    [ana],
    `The tool got the session ${show(seen[0])} for a call whose arguments name Chen's email, in Ana's session. Only the login says who the customer is: the tool should get the session runToolCall got, ${show(ana)}.`,
  );
});

test("answers every call with a tool message that names its id, failed calls too", async () => {
  const logged = [];
  const ran = [];
  const tools = new Map([
    [
      "get_order",
      async ({ orderId }) => {
        ran.push(orderId);
        if (orderId === 1040) throw new Error("connection terminated: orders-db-eu-2.internal:5432");
        return { id: orderId, status: "shipped" };
      },
    ],
  ]);
  const calls = [
    { id: "call_M1", type: "function", function: { name: "get_order", arguments: '{"orderId":1048}' } },
    { id: "call_M2", type: "function", function: { name: "get_order", arguments: '{"orderId":1040}' } },
    { id: "call_M3", type: "function", function: { name: "get_order", arguments: '{"orderId":104' } },
  ];
  const messages = [];
  for (const call of calls) {
    try {
      messages.push(await runToolCall(call, ana, tools, (message) => logged.push(message)));
    } catch (error) {
      rethrowNotBuilt(error);
      assert.fail(`runToolCall threw "${error.message}" for ${call.id}. Every call needs a tool message, even a failed one.`);
    }
  }
  for (const [i, call] of calls.entries()) {
    assert.equal(messages[i]?.role, "tool", `runToolCall returned ${show(messages[i])} for ${call.id}. It should return a message with role "tool".`);
    assert.equal(messages[i].tool_call_id, call.id, `The tool message for ${call.id} has tool_call_id ${show(messages[i].tool_call_id)}. It should copy the call's id, "${call.id}".`);
  }
  const awaited = messages[0].content === "{}" ? " (a Promise turns into {}: did you await the tool?)" : "";
  assert.equal(
    messages[0].content,
    '{"id":1048,"status":"shipped"}',
    `The content for call_M1 was ${show(messages[0].content)}${awaited}. It should be the tool's result as JSON: '{"id":1048,"status":"shipped"}'.`,
  );
  let error;
  try {
    error = JSON.parse(messages[1].content)?.error;
  } catch {}
  assert.ok(
    !messages[1].content?.includes("orders-db-eu-2") && error,
    `The content for call_M2, whose lookup threw "connection terminated: orders-db-eu-2.internal:5432", was ${show(messages[1].content)}. The model should get a safe JSON error, with an error field and without your database's host name.`,
  );
  assert.ok(
    logged.some((line) => String(line).includes("orders-db-eu-2")),
    `runToolCall logged ${show(logged)}. Log a line with the error's message, so you can find out what failed.`,
  );
  assert.equal(
    messages[2].content,
    JSON.stringify({ error: "arguments are not valid JSON" }),
    `The content for call_M3, whose arguments were '{"orderId":104', was ${show(messages[2].content)}. It should be '{"error":"arguments are not valid JSON"}', so the model can fix its call instead of trying it again.`,
  );
  assert.deepEqual(ran, [1048, 1040], `The tool ran for the order ids ${show(ran)}. It should run for call_M1 and call_M2 only: call_M3's arguments aren't JSON, so there's nothing to run it with.`);
});
