// Milestone 2: streaming and tools. The events and tool calls are made-up examples, not recorded
// ones. The orders are the dataset's, from data/orders.json.

import assert from "node:assert/strict";
import { test } from "node:test";
import { orderLookup } from "../src/lib/orders.mjs";
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

const text = (value) => ({ type: "text", text: value });
const findOrder = orderLookup();
// Chen Wei placed order 1042 at Kettle & Co. Dara Khan placed order 1043 there.
const chen = { tenantId: "kettleandco", email: "chen.wei@example.com" };

test("marks a stream that ends without a finish event as interrupted", async () => {
  const answer = await readStream(stream([text("Your order 1042 "), text("was delivered on")])); // the connection drops
  assert.equal(
    answer?.status,
    "interrupted",
    `readStream returned ${show(answer)} for a stream that ended without a finish event. The end of a stream only means no more data is coming: the status should stay "interrupted".`,
  );
  assert.equal(answer.text, "Your order 1042 was delivered on", `readStream's text was ${show(answer.text)}. It should keep the text it got: "Your order 1042 was delivered on".`);

  const finished = await readStream(stream([text("Order 1042 was delivered."), { type: "finish", status: "complete" }]));
  assert.equal(finished?.status, "complete", `readStream returned ${show(finished)} for a stream with a finish event. The status should be the finish event's, "complete".`);
});

test("keeps the usage unknown when the stream ends before its usage event", async () => {
  const finish = { type: "finish", status: "complete" };
  const withUsage = await readStream(stream([text("Order 1042 shipped."), finish, { type: "usage", input: 212, output: 18 }]));
  assert.deepEqual(withUsage?.usage, { input: 212, output: 18 }, `readStream's usage was ${show(withUsage?.usage)} for a stream with a usage event. It should be { input: 212, output: 18 }.`);

  const withoutUsage = await readStream(stream([text("Order 1042 shipped."), finish])); // it drops before the usage
  assert.equal(
    withoutUsage?.usage,
    null,
    `readStream's usage was ${show(withoutUsage?.usage)} for a complete answer whose usage event never arrived. Usage is unknown, not zero tokens: it should stay null.`,
  );
});

test("stops at an error event, and skips event types it doesn't handle", async () => {
  const events = [text("Order 1042"), { type: "ping" }, { type: "error", message: "Overloaded" }, text(" ships."), { type: "finish", status: "complete" }];
  let answer;
  try {
    answer = await readStream(stream(events));
  } catch (error) {
    rethrowNotBuilt(error);
    assert.fail(`readStream threw "${error.message}" for a stream with a ping event. Skip the event types you don't handle.`);
  }
  const expected = { status: "failed", text: "Order 1042", usage: null, error: "Overloaded" };
  assert.deepEqual(
    answer,
    expected,
    `readStream returned ${show(answer)} for text, a ping, an error, then more text. The error ends the answer: it should return ${show(expected)}.`,
  );
});

test("looks up the session customer's own order, with only the fields the answer needs", async () => {
  const result = await getOrder({ orderId: 1042 }, chen, findOrder);
  const expected = { id: 1042, status: "delivered", totalCents: 12900, orderedOn: "2026-09-30" };
  assert.deepEqual(
    result,
    expected,
    `getOrder({ orderId: 1042 }) for Chen returned ${show(result)}. The customer can read whatever a tool returns, so it should return only ${show(expected)}.`,
  );
});

test("answers another customer's order, another shop's, and a missing one the same way", async () => {
  const cases = [
    ["Dara's order 1043", { orderId: 1043 }, chen],
    ["Dara's order 1043, with Dara's email in the arguments", { orderId: 1043, email: "dara.khan@example.com", tenantId: "kettleandco" }, chen],
    ["order 1042, from a Deskworks session with Chen's email", { orderId: 1042 }, { tenantId: "deskworks", email: "chen.wei@example.com" }],
    ["order 9999, which doesn't exist", { orderId: 9999 }, chen],
  ];
  for (const [label, args, session] of cases) {
    const result = await getOrder(args, session, findOrder);
    assert.deepEqual(
      result,
      { error: "order not found" },
      `getOrder returned ${show(result)} for ${label}. The customer and the shop come from the session, never from the arguments, and every order that isn't theirs gets the same answer: { error: 'order not found' }.`,
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
        return { id: 1042, status: "delivered" };
      },
    ],
  ]);
  for (const name of ["refund_order", "toString"]) {
    const call = { id: "call_X1", type: "function", function: { name, arguments: '{"orderId":1042}' } };
    let message;
    try {
      message = await runToolCall(call, chen, tools, () => {});
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

test("answers every call with a tool message that names its id, failed calls too", async () => {
  const logged = [];
  const tools = new Map([
    [
      "get_order",
      async ({ orderId }) => {
        if (orderId === 1043) throw new Error("query timeout on orders_replica_2");
        return { id: orderId, status: "delivered" };
      },
    ],
  ]);
  const calls = [
    { id: "call_B1", type: "function", function: { name: "get_order", arguments: '{"orderId":1042}' } },
    { id: "call_B2", type: "function", function: { name: "get_order", arguments: '{"orderId":1043}' } },
    { id: "call_B3", type: "function", function: { name: "get_order", arguments: '{"orderId":10' } },
  ];
  const messages = [];
  for (const call of calls) {
    try {
      messages.push(await runToolCall(call, chen, tools, (message) => logged.push(message)));
    } catch (error) {
      rethrowNotBuilt(error);
      assert.fail(`runToolCall threw "${error.message}" for ${call.id}. Every call needs a tool message, even a failed one.`);
    }
  }
  for (const [i, call] of calls.entries()) {
    assert.equal(messages[i]?.role, "tool", `runToolCall returned ${show(messages[i])} for ${call.id}. It should return a message with role "tool".`);
    assert.equal(messages[i].tool_call_id, call.id, `The tool message for ${call.id} has tool_call_id ${show(messages[i].tool_call_id)}. It should copy the call's id, "${call.id}".`);
  }
  assert.equal(messages[0].content, '{"id":1042,"status":"delivered"}', `The content for call_B1 was ${show(messages[0].content)}. It should be the result as JSON: '{"id":1042,"status":"delivered"}'.`);
  assert.ok(
    !messages[1].content.includes("orders_replica_2") && JSON.parse(messages[1].content).error,
    `The content for call_B2, whose lookup threw "query timeout on orders_replica_2", was ${show(messages[1].content)}. The model should get a safe JSON error, without your database's host name.`,
  );
  assert.ok(
    logged.some((line) => line.includes("orders_replica_2")),
    `runToolCall logged ${show(logged)}. Log the error's details with log(), so you can find out what failed.`,
  );
  assert.equal(
    messages[2].content,
    JSON.stringify({ error: "arguments are not valid JSON" }),
    `The content for call_B3, whose arguments were '{"orderId":10', was ${show(messages[2].content)}. It should be '{"error":"arguments are not valid JSON"}'.`,
  );
});
