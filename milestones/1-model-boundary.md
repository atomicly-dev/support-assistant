# Milestone 1: The model boundary

Read this on atomicly, with the tutor next to it: [milestone 1 on atomicly](https://atomicly.dev/projects/proj-support-assistant/milestones/proj-support-m1).

Lessons: [Model API responses: what happens in a model call](https://atomicly.dev/lessons/ai-model-boundary) and [Structured output: turn model output into validated data](https://atomicly.dev/lessons/ai-structured-results)

## The situation

Before the assistant can answer a customer, it routes the message. Is it a policy question, a question about an order, a refund request, or something else? The assistant asks the model with structured output, and gets back `{"category": "order", "orderId": 1042}`.

The first version read `choices[0].message.content` and ran `JSON.parse` on it. Then a reply hit the token limit and came back cut off, still with a `200`, and the parse threw. Another reply was a refusal, with `finish_reason: "stop"` and no content at all. A third had a category the code doesn't have.

So you'll read the response once, where it enters your code, and turn it into a result with a status. Every later step works with that result instead of the raw envelope. From here on, the project calls `model.complete(request)` and gets that result back.

## What you build

You'll write both functions in `src/model.mjs`. It already has `CATEGORIES`, the routing instructions, the JSON Schema in `ROUTE_FORMAT`, and `routeRequest(message)`, which builds the request.

**`readCompletion(completion)`** takes a parsed Chat Completions response body, such as:

```js
{
  choices: [{ index: 0, message: { role: "assistant", content: "Order 1042 shipped.", refusal: null }, finish_reason: "stop" }],
  usage: { prompt_tokens: 212, completion_tokens: 18 },
}
```

It returns a result, `{ status, text, usage }`, where `usage` is `{ input, output }`, taken from the prompt tokens and the completion tokens. The status and the text depend on the reply:

| The reply | `status` | `text` |
| --- | --- | --- |
| `finish_reason: "stop"` | `"complete"` | the message's `content` |
| `finish_reason: "length"` | `"cut_off"` | the message's `content` |
| `finish_reason: "tool_calls"` | `"tool_call"` | the message's `content` |
| `finish_reason: "content_filter"` | `"filtered"` | the message's `content` |
| a `message.refusal` | `"refused"` | `null` |

**`readRoute(result)`** takes a result from `readCompletion`. It returns `{ ok: true, route: { category, orderId } }`, or `{ ok: false, reason }` when the result isn't a route:

| The result | `reason` |
| --- | --- |
| Its `status` isn't `"complete"` | the status, such as `"cut_off"` |
| Its `text` isn't JSON | `"invalid JSON"` |
| Its `category` isn't one of `CATEGORIES` | `` `unknown category: ${category}` `` |
| Its `orderId` isn't an integer or `null` | `"orderId must be an integer or null"` |

## The rules

- A reply with a `message.refusal` is `"refused"`, whatever its `finish_reason`.
- Every result keeps its usage, whatever its status, because you pay for every token.
- For a `finish_reason` that isn't in the table, `readCompletion` throws an error that names it.
- Only a complete result's text becomes a route, even when another status's text parses.
- `readRoute` never throws for a bad reply. It returns the reason, so the assistant can hand the message to a person.

## The new case

For an hour, a deploy sent the routing request without `response_format`. The replies were still JSON, but they weren't always a route:

- `null`, for an empty message, which crashed the first version of the router
- a list with the route inside it
- the right route, with an extra `note` field, which the next step showed to the customer

What should `readRoute` return for each one? The last check, "checks the JSON's shape, even without the schema", replays all three.

## Run the checks

```sh
npm run milestone -- 1
```

These checks don't need the database or an API key:

- reads each finish_reason as its status, with the text and the usage
- reads a refusal as refused, whatever its finish_reason
- throws for an unknown finish_reason
- reads a route only from a complete result
- rejects a route that doesn't match the schema
- checks the JSON's shape, even without the schema

## Hints

Stuck? The hints go from where the course teaches this, to the approach, to a detail people often get wrong.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Model API responses](https://atomicly.dev/lessons/ai-model-boundary): section 2, *Why the model stopped*, has a refusal with `finish_reason: "stop"`. In section 3, *Read the envelope in one place*, the lesson's code reads the envelope into a result.
- [Structured output](https://atomicly.dev/lessons/ai-structured-results): in section 3, *Check the status, then the data*, the lesson reads a route with a different set of categories.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `readCompletion`: check for a refusal before you look at `finish_reason`, because `finish_reason` can't show one. Then map `finish_reason` to a status with a lookup table, and throw when it isn't in the table.
- `readRoute`: return early for a status that isn't complete, and parse inside a `try`. Then check the parsed value the way you'd check a request body. Is it an object? Is its category one you know? Is its `orderId` an integer or `null`? Build the route from the two fields you checked. For anything that isn't a route, return `ok: false` with any reason you like.

</details>

<details>
<summary>Hint 3: a detail that's easy to get wrong</summary>

`typeof orderId === "number"` lets `1042.5` through. `Number.isInteger` returns `true` only for a whole number, and `false` for a string such as `"1042"`.

</details>

## The solution

On the `solutions` branch, this milestone's code is in [`src/model.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/model.mjs).
