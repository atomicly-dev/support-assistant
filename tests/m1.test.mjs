// Milestone 1: the model boundary. The envelopes below are made-up examples of Chat Completions
// response bodies, not recorded ones.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompletion, readRoute } from "../src/model.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

const envelope = (message, finish_reason, usage = { prompt_tokens: 212, completion_tokens: 18 }) => ({
  choices: [{ index: 0, message: { role: "assistant", refusal: null, ...message }, finish_reason }],
  usage,
});

test("reads a finished reply as complete, with its usage", () => {
  const result = readCompletion(envelope({ content: "Order 1042 was delivered on October 2." }, "stop"));
  const expected = { status: "complete", text: "Order 1042 was delivered on October 2.", usage: { input: 212, output: 18 } };
  assert.deepEqual(result, expected, `readCompletion returned ${show(result)} for a finished reply. It should return ${show(expected)}.`);
});

test("reads a reply cut off at the token limit as cut_off", () => {
  const cutOff = envelope({ content: "Your refund for order 1042 is approved, and the money goes back to" }, "length", {
    prompt_tokens: 212,
    completion_tokens: 300,
  });
  const result = readCompletion(cutOff);
  assert.equal(
    result?.status,
    "cut_off",
    `readCompletion returned ${show(result)} for finish_reason "length". A reply that hit the token limit isn't finished: its status should be "cut_off", so nobody sends half a sentence to the customer.`,
  );
  assert.deepEqual(result.usage, { input: 212, output: 300 }, `The cut-off reply's usage came back as ${show(result.usage)}. You pay for those tokens too, so keep { input: 212, output: 300 }.`);
});

test("reads a refusal as refused, though finish_reason is stop", () => {
  const refusal = envelope({ content: null, refusal: "I can't help with that request." }, "stop", { prompt_tokens: 198, completion_tokens: 9 });
  const result = readCompletion(refusal);
  const expected = { status: "refused", text: null, usage: { input: 198, output: 9 } };
  assert.deepEqual(
    result,
    expected,
    `readCompletion returned ${show(result)} for a reply with a refusal and finish_reason "stop". finish_reason can't show a refusal, so check message.refusal first: it should return ${show(expected)}.`,
  );
});

test("throws for a finish_reason it doesn't know", () => {
  let result;
  let thrown;
  try {
    result = readCompletion(envelope({ content: "Let me check." }, "function_call"));
  } catch (error) {
    rethrowNotBuilt(error);
    thrown = error;
  }
  assert.ok(
    thrown && /function_call/.test(thrown.message),
    thrown
      ? `readCompletion threw "${thrown.message}" for finish_reason "function_call". The error should name the value, such as "Unknown finish_reason: function_call".`
      : `readCompletion returned ${show(result)} for finish_reason "function_call". An unknown value may not be a finished answer, so it should throw an error that names it.`,
  );
});

test("reads a route only from a complete result", () => {
  const valid = readRoute({ status: "complete", text: '{"category":"order","orderId":1042}', usage: { input: 150, output: 12 } });
  const expected = { ok: true, route: { category: "order", orderId: 1042 } };
  assert.deepEqual(valid, expected, `readRoute returned ${show(valid)} for a complete, valid route. It should return ${show(expected)}.`);

  for (const status of ["cut_off", "refused", "filtered"]) {
    const text = status === "refused" ? null : '{"category": "refund", "orderI';
    let result;
    try {
      result = readRoute({ status, text, usage: { input: 150, output: 100 } });
    } catch (error) {
      rethrowNotBuilt(error);
      assert.fail(`readRoute threw "${error.message}" for a ${status} result. Check the status before you parse: it should return { ok: false, reason: '${status}' }.`);
    }
    assert.deepEqual(
      result,
      { ok: false, reason: status },
      `readRoute returned ${show(result)} for a ${status} result. Only a complete result gets parsed: it should return { ok: false, reason: '${status}' }.`,
    );
  }
});

test("rejects a route that doesn't match the schema", () => {
  const cases = [
    ["Sure! It's about order 1042.", "invalid JSON"],
    ['{"category":"damaged_item","orderId":1042}', "unknown category: damaged_item"],
    ['{"category":"order","orderId":"1042"}', "orderId must be an integer or null"],
  ];
  for (const [text, reason] of cases) {
    let result;
    try {
      result = readRoute({ status: "complete", text, usage: { input: 150, output: 12 } });
    } catch (error) {
      rethrowNotBuilt(error);
      assert.fail(`readRoute threw "${error.message}" for the reply ${show(text)}. A bad reply is an outcome to expect: it should return { ok: false, reason: '${reason}' }.`);
    }
    assert.deepEqual(result, { ok: false, reason }, `readRoute returned ${show(result)} for the reply ${show(text)}. It should return { ok: false, reason: '${reason}' }.`);
  }
  const noOrder = readRoute({ status: "complete", text: '{"category":"policy","orderId":null}', usage: { input: 150, output: 12 } });
  assert.deepEqual(
    noOrder,
    { ok: true, route: { category: "policy", orderId: null } },
    `readRoute returned ${show(noOrder)} for a policy question with orderId null. null is a valid orderId, for a message that names no order.`,
  );
});
