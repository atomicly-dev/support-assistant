# Milestone 1: The model boundary

Lessons: [Model API responses: what happens in a model call](https://atomicly.dev/lessons/ai-model-boundary) and [Structured output: turn model output into validated data](https://atomicly.dev/lessons/ai-structured-results)

## The situation

The assistant's first step routes each customer message: is it a policy question, a question about an order, a refund request, or something else? It asks the model, with structured output, and gets back `{"category": "order", "orderId": 1042}`.

The first version read `choices[0].message.content` and ran `JSON.parse` on it. Then a reply came back cut off at the token limit, with a `200`, and the parse threw. Another came back refused, with `finish_reason: "stop"` and no content at all. A third named a category nobody had heard of.

So you'll read the response once, where it enters your code, and every later step gets a result with a status instead of the raw envelope. From here on, the project calls `model.complete(request)` and gets that result.

## What you build

Both functions go in `src/model.mjs`.

**`readCompletion(completion)`** takes a parsed Chat Completions response body and returns `{ status, text, usage }`:

- `status` comes from `finish_reason`: `stop` is `"complete"`, `length` is `"cut_off"`, `tool_calls` is `"tool_call"`, and `content_filter` is `"filtered"`.
- A reply with a `message.refusal` is `"refused"`, whatever its `finish_reason`, and its `text` is `null`.
- `text` is `message.content`.
- `usage` is `{ input, output }`, from `usage.prompt_tokens` and `usage.completion_tokens`. Keep it for every status, because you pay for every token.
- For a `finish_reason` that isn't in that list, it throws an error that names the value.

**`readRoute(result)`** takes a result from `readCompletion` and returns `{ ok: true, route: { category, orderId } }`, or `{ ok: false, reason }`:

- A result whose status isn't `"complete"` gets that status as the reason, such as `{ ok: false, reason: "cut_off" }`. Don't parse it.
- Text that isn't JSON gets `"invalid JSON"`.
- A category outside `CATEGORIES` gets `` `unknown category: ${category}` ``.
- An `orderId` that isn't an integer or `null` gets `"orderId must be an integer or null"`.

The file already has the parts that aren't this milestone's idea: `CATEGORIES`, the routing instructions, the JSON Schema in `ROUTE_FORMAT`, and `routeRequest(message)`, which builds the request.

## Run the checks

```sh
npm run milestone -- 1
```

The checks need no database and no key:

- reads a finished reply as complete, with its usage
- reads a reply cut off at the token limit as cut_off
- reads a refusal as refused, though finish_reason is stop
- throws for a finish_reason it doesn't know
- reads a route only from a complete result
- rejects a route that doesn't match the schema

## Hints

- Section 3 of [Model API responses](https://atomicly.dev/lessons/ai-model-boundary), *Read the envelope in one place*, builds `readCompletion` with a `Map` from `finish_reason` to a status. Why does it check `refusal` before `finish_reason`? Section 2, *Why the model stopped*, shows the refused reply.
- Section 3 of [Structured output](https://atomicly.dev/lessons/ai-structured-results), *Check the status, then the data*, writes `readRoute` for another set of categories. It returns the problem instead of throwing, because a bad reply is an outcome to expect.
- Section 4 of the same lesson shows why a route that passes isn't the end of the checks: the order can belong to someone else. Milestone 2's order lookup checks that.

## The solution

The `solutions` branch has every milestone built. This one is in [`src/model.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/model.mjs).
