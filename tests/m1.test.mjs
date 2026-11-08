// Milestone 1: the model boundary. The envelopes below are made-up Chat Completions response
// bodies, not recorded ones.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readCompletion, readRoute } from "../src/model.mjs";
import { rethrowNotBuilt, show } from "./helpers.mjs";

const envelope = (message, finish_reason, usage) => ({
  choices: [{ index: 0, message: { role: "assistant", content: null, refusal: null, ...message }, finish_reason }],
  usage: { prompt_tokens: usage[0], completion_tokens: usage[1] },
});

// Calls readCompletion, and turns a thrown error into a string the failure message can show.
function read(completion) {
  try {
    return readCompletion(completion);
  } catch (error) {
    rethrowNotBuilt(error);
    return `an error: ${error.message}`;
  }
}

// Calls readRoute, and fails the check with `advice` when it throws.
function route(result, advice) {
  try {
    return readRoute(result);
  } catch (error) {
    rethrowNotBuilt(error);
    assert.fail(`readRoute threw "${error.message}" for ${show(result)}. ${advice}`);
  }
}

test("reads each finish_reason as its status, with the text and the usage", () => {
  const lookup = { id: "call_K7", type: "function", function: { name: "get_order", arguments: '{"orderId":1047}' } };
  const cases = [
    ["stop", { content: "Your order 1047 left our warehouse on October 21." }, [187, 14], "complete", "the model finished its answer"],
    ["length", { content: "Your refund for order 1047 goes back to the card you" }, [187, 100], "cut_off", "a reply that hit the token limit isn't finished, so nobody should send half a sentence"],
    ["tool_calls", { tool_calls: [lookup] }, [240, 22], "tool_call", "the model asked your code to run a tool"],
    ["content_filter", { content: "To clean the grinder, first" }, [160, 7], "filtered", "the provider's filter left out part of the reply"],
  ];
  for (const [reason, message, usage, status, why] of cases) {
    const result = read(envelope(message, reason, usage));
    const expected = { status, text: message.content ?? null, usage: { input: usage[0], output: usage[1] } };
    const label = `readCompletion returned ${show(result)} for finish_reason "${reason}".`;
    assert.equal(result?.status, status, `${label} Its status should be "${status}": ${why}.`);
    assert.deepEqual(result.usage, expected.usage, `${label} You pay for every token, whatever the status, so its usage should be ${show(expected.usage)}.`);
    assert.deepEqual(result, expected, `${label} It should return ${show(expected)}, with the message's content as its text.`);
  }
});

test("reads a refusal as refused, whatever its finish_reason", () => {
  const refusals = [
    ["stop", "I'm sorry, I can't share another customer's details.", [205, 12]],
    ["length", "I'm sorry, I can't sh", [205, 100]],
    ["content_filter", "I'm sorry", [205, 3]],
  ];
  for (const [reason, refusal, usage] of refusals) {
    const result = read(envelope({ refusal }, reason, usage));
    const expected = { status: "refused", text: null, usage: { input: usage[0], output: usage[1] } };
    const label = `readCompletion returned ${show(result)} for a reply with a refusal and finish_reason "${reason}".`;
    assert.equal(result?.status, "refused", `${label} finish_reason can't show a refusal, so a reply with message.refusal is "refused" whatever its finish_reason.`);
    assert.equal(result.text, null, `${label} A refusal has no text to send, so its text should be null.`);
    assert.deepEqual(result, expected, `${label} You pay for a refusal's tokens too: it should return ${show(expected)}.`);
  }
});

test("throws for an unknown finish_reason", () => {
  // A provider with a Chat Completions API can send values OpenAI doesn't, such as this one.
  const result = read(envelope({ content: "Let me check that order" }, "insufficient_system_resource", [190, 6]));
  assert.ok(
    typeof result === "string" && result.includes("insufficient_system_resource"),
    typeof result === "string"
      ? `readCompletion threw "${result.slice("an error: ".length)}" for finish_reason "insufficient_system_resource". Put the value in the error's message, so the log shows what came back.`
      : `readCompletion returned ${show(result)} for finish_reason "insufficient_system_resource". An unknown value might not mean a finished answer, so it should throw an error that names it.`,
  );
});

test("reads a route only from a complete result", () => {
  const valid = route({ status: "complete", text: '{"category":"refund","orderId":1047}', usage: { input: 150, output: 12 } }, "A complete reply with a valid route should return the route.");
  const expected = { ok: true, route: { category: "refund", orderId: 1047 } };
  assert.deepEqual(valid, expected, `readRoute returned ${show(valid)} for a complete, valid route. It should return ${show(expected)}.`);

  const others = [
    ["cut_off", '{"category":"refund","order'],
    ["filtered", '{"category":"other","orderId":null}'], // what's left after the filter happens to parse
    ["refused", null],
    ["tool_call", null],
  ];
  for (const [status, text] of others) {
    const result = route({ status, text, usage: { input: 150, output: 100 } }, `Check the status before you parse: it should return { ok: false, reason: '${status}' }.`);
    assert.deepEqual(
      result,
      { ok: false, reason: status },
      `readRoute returned ${show(result)} for a ${status} result with the text ${show(text)}. Only a complete result's text becomes a route, even when another status's text parses: it should return { ok: false, reason: '${status}' }.`,
    );
  }
});

test("rejects a route that doesn't match the schema", () => {
  const cases = [
    ["Sure, that's about order 1047.", "invalid JSON"],
    ['{"category":"shipping","orderId":1047}', "unknown category: shipping"],
    ['{"category":"order","orderId":"1047"}', "orderId must be an integer or null"],
    ['{"category":"order","orderId":1047.5}', "orderId must be an integer or null"],
    ['{"category":"order"}', "orderId must be an integer or null"],
  ];
  for (const [text, reason] of cases) {
    const result = route({ status: "complete", text, usage: { input: 150, output: 12 } }, `Bad replies happen, so don't throw: return { ok: false, reason: '${reason}' }.`);
    assert.deepEqual(result, { ok: false, reason }, `readRoute returned ${show(result)} for the reply ${show(text)}. It should return { ok: false, reason: '${reason}' }.`);
  }
  const noOrder = route({ status: "complete", text: '{"category":"policy","orderId":null}', usage: { input: 150, output: 12 } }, "orderId can be null.");
  assert.deepEqual(
    noOrder,
    { ok: true, route: { category: "policy", orderId: null } },
    `readRoute returned ${show(noOrder)} for a policy question with orderId null. orderId is null when the message names no order, and that's valid.`,
  );
});

test("checks the JSON's shape, even without the schema", () => {
  // The new case: for an hour, a deploy sent the routing request without response_format.
  for (const text of ["null", '[{"category":"order","orderId":1047}]', '"order"']) {
    const result = route(
      { status: "complete", text, usage: { input: 150, output: 4 } },
      "The text parsed, but it's still data from outside your program: check that it's an object before you read its fields.",
    );
    assert.ok(
      result?.ok === false && typeof result.reason === "string" && result.reason.length > 0,
      `readRoute returned ${show(result)} for the reply ${show(text)}. It's valid JSON, but not a route object: it should return { ok: false, reason }, with any reason you like.`,
    );
  }
  const extra = route({ status: "complete", text: '{"category":"order","orderId":1047,"note":"Customer says it is urgent"}', usage: { input: 150, output: 20 } }, "An extra field isn't an error.");
  const expected = { ok: true, route: { category: "order", orderId: 1047 } };
  assert.deepEqual(
    extra,
    expected,
    `readRoute returned ${show(extra)} for a route with an extra field, "note". The rest of the assistant gets only the fields you checked: it should return ${show(expected)}.`,
  );
});
