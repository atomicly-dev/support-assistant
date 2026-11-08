// For the template's maintainers: tests for scripts/annotations.mjs. template-ci.yml runs them with
// `node --test scripts/annotations.test.mjs`. They aren't milestone checks.

import assert from "node:assert/strict";
import { test } from "node:test";
import { annotations, escapeData, escapeProperty, limit, shorten } from "./annotations.mjs";

const failure = (n) => ({ name: `check ${n}`, message: `reason ${n}` });

test("escapes %, CR, and LF in a message, and keeps : and ,", () => {
  assert.equal(escapeData("50% off\r\nnext: kettles, mugs"), "50%25 off%0D%0Anext: kettles, mugs");
});

test("escapes % first, so text that looks like an escape stays as it was", () => {
  assert.equal(escapeData("%0A"), "%250A");
});

test("also escapes : and , in a title", () => {
  assert.equal(escapeProperty("refunds: 50%, then\nmore"), "refunds%3A 50%25%2C then%0Amore");
});

test("keeps a message of 1,000 characters, and cuts a longer one to 1,000 with …", () => {
  assert.equal(shorten("x".repeat(1000)), "x".repeat(1000));
  assert.equal(shorten("x".repeat(1001)), `${"x".repeat(999)}…`);
  assert.equal(shorten("🫖".repeat(1001)), `${"🫖".repeat(999)}…`, "it counts characters, so it never cuts one in half");
});

test("cuts a message before it escapes it, so an escape stays whole", () => {
  const [line] = annotations([{ name: "check 1", message: `${"x".repeat(998)}\n\n\n` }]);
  assert.equal(line, `::error title=check 1::${"x".repeat(998)}%0A…`);
});

test("keeps up to 10 failures as they are", () => {
  const ten = Array.from({ length: 10 }, (_, i) => failure(i + 1));
  assert.deepEqual(limit(ten), ten);
});

test("past 10 failures, keeps the first 9 and counts the rest in a 10th", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => failure(i + 1));
  assert.deepEqual(limit(twelve), [...twelve.slice(0, 9), { name: "more checks failed", message: "3 more checks failed. See the log." }]);
});

test("prints one ::error command per failing check, with its name as the title", () => {
  assert.deepEqual(
    annotations([
      { name: "searches only the session's shop", message: "search returned 2 Deskworks chunks.\nIt should return only kettleandco's." },
      { name: "rejects an answer with no citations, or one that cites a chunk that wasn't sent", message: "Not built yet: milestone 3" },
    ]),
    [
      "::error title=searches only the session's shop::search returned 2 Deskworks chunks.%0AIt should return only kettleandco's.",
      "::error title=rejects an answer with no citations%2C or one that cites a chunk that wasn't sent::Not built yet: milestone 3",
    ],
  );
});

test("prints nothing when every check passes", () => {
  assert.deepEqual(annotations([]), []);
});
