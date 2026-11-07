# Milestone 1: The model boundary

Lessons: [Model API responses: what happens in a model call](https://atomicly.dev/lessons/ai-model-boundary) and [Structured output: turn model output into validated data](https://atomicly.dev/lessons/ai-structured-results)

## The situation

The assistant's first step routes each customer message: is it a policy question, a question about an order, a refund request, or something else? It asks the model, with structured output, and gets back `{"category": "order", "orderId": 1042}`.

The first version read `choices[0].message.content` and ran `JSON.parse` on it. Then a reply came back cut off at the token limit, with a `200`, and the parse threw. Another came back refused, with `finish_reason: "stop"` and no content at all. A third named a category the code doesn't have.

So you'll read the response once, where it enters your code. Every later step gets a result with a status, not the raw envelope. From here on, the project calls `model.complete(request)` and gets that result.

## What you build

Both functions go in `src/model.mjs`. The file already has `CATEGORIES`, the routing instructions, the JSON Schema in `ROUTE_FORMAT`, and `routeRequest(message)`, which builds the request.

**`readCompletion(completion)`** takes a parsed Chat Completions response body, such as:

```js
{
  choices: [{ index: 0, message: { role: "assistant", content: "Order 1042 shipped.", refusal: null }, finish_reason: "stop" }],
  usage: { prompt_tokens: 212, completion_tokens: 18 },
}
```

It returns a result, `{ status, text, usage }`. `usage` is `{ input, output }`, from the prompt tokens and the completion tokens. The status and the text depend on the reply:

| The reply | `status` | `text` |
| --- | --- | --- |
| `finish_reason: "stop"` | `"complete"` | the message's `content` |
| `finish_reason: "length"` | `"cut_off"` | the message's `content` |
| `finish_reason: "tool_calls"` | `"tool_call"` | the message's `content` |
| `finish_reason: "content_filter"` | `"filtered"` | the message's `content` |
| a `message.refusal` | `"refused"` | `null` |

**`readRoute(result)`** takes a result from `readCompletion`, and returns `{ ok: true, route: { category, orderId } }` or `{ ok: false, reason }`:

| The result | `reason` |
| --- | --- |
| Its `status` isn't `"complete"` | the status, such as `"cut_off"` |
| Its `text` isn't JSON | `"invalid JSON"` |
| Its `category` isn't one of `CATEGORIES` | `` `unknown category: ${category}` `` |
| Its `orderId` isn't an integer or `null` | `"orderId must be an integer or null"` |

## The rules

- A reply with a `message.refusal` is `"refused"`, whatever its `finish_reason`.
- Every result keeps its usage, whatever its status, because you pay for every token.
- A `finish_reason` that isn't in the table throws an error that names it.
- Only a complete result's text becomes a route, even when another status's text parses.
- `readRoute` never throws for a bad reply. It returns the reason, so the assistant can hand the message to a person.

## The new case

For an hour, a deploy sent the routing request without `response_format`. The replies were still JSON, but not always a route:

- `null`, for an empty message, which crashed the first version of the router
- a list with the route inside it
- the right route, with an extra `note` field, which the next step showed to the customer

What should `readRoute` return for each of them? The check **checks the shape of JSON the schema would have stopped, such as null** replays them.

## Run the checks

```sh
npm run milestone -- 1
```

The checks need no database and no key:

- reads each finish_reason as its status, with the text and the usage
- reads a refusal as refused, whatever its finish_reason
- throws for a finish_reason it doesn't know
- reads a route only from a complete result
- rejects a route that doesn't match the schema
- checks the shape of JSON the schema would have stopped, such as null

## Hints

Open them one at a time, when you're stuck.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Model API responses](https://atomicly.dev/lessons/ai-model-boundary): section 2, *Why the model stopped*, shows a refusal with `finish_reason: "stop"`. Section 3, *Read the envelope in one place*, reads the envelope into a result.
- [Structured output](https://atomicly.dev/lessons/ai-structured-results): section 3, *Check the status, then the data*, reads a route for another set of categories.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `readCompletion`: look for the refusal before you look at `finish_reason`, because `finish_reason` can't show one. Then turn `finish_reason` into a status with a lookup table, and throw when the table has no entry.
- `readRoute`: return early for a status that isn't complete, and parse inside a `try`. Then check the parsed value like a request body: is it an object, is its category one you know, is its `orderId` an integer or `null`? Build the route from the two fields you checked, and give anything that isn't a route a reason you choose.

</details>

<details>
<summary>Hint 3: a detail that's easy to get wrong</summary>

`typeof orderId === "number"` lets `1042.5` through. `Number.isInteger` is `true` only for a whole number, and `false` for a string such as `"1042"`.

</details>

## The solution

The `solutions` branch has every milestone built. This one is in [`src/model.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/model.mjs).
