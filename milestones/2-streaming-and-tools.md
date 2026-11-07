# Milestone 2: Streaming and tools

Lessons: [Streaming: a partial answer isn't a finished answer](https://atomicly.dev/lessons/ai-stream-events), [Tool calling: a call is a request for your code to act](https://atomicly.dev/lessons/ai-tool-contracts), and [The agent loop: complete the tool exchange](https://atomicly.dev/lessons/ai-tool-transcript)

## The situation

A customer asks "Where is order 1042?". The assistant streams its answer, so the customer reads it as it arrives, and it gives the model a `get_order` tool to look the order up.

Two things went wrong in the first version. A dropped connection ended the stream the same way a finished answer does, so a customer saw half a sentence marked done. And the tool took the customer's email as an argument, so a customer who typed someone else's email got that person's order.

## What you build

**`readStream(events)`**, in `src/stream.mjs`, builds the answer from a stream's typed events. The model client already turns the provider's chunks into these events:

- `{ type: "text", text }`: a piece of the answer
- `{ type: "finish", status }`: the terminal event, with a status like `readCompletion`'s
- `{ type: "usage", input, output }`: the token counts, which can arrive after the finish, or never
- `{ type: "error", message }`: the provider failed after the stream started

It resolves to `{ status, text, usage, error }`:

- `status` starts as `"interrupted"`, and only a `finish` event changes it, to the status it carries.
- `text` adds up the `text` events.
- `usage` stays `null` until a `usage` event arrives. Unknown usage isn't zero tokens.
- An `error` event sets `status` to `"failed"` and `error` to its message, and ends the answer. Nothing after it joins the text.
- Any other type, such as `ping` or `tool_calls`, gets skipped.

**`getOrder(args, session, findOrder)`**, in `src/tools.mjs`, is the `get_order` tool. `args` come from the model, and `session` is `{ tenantId, email }`, from the customer's login. `findOrder(orderId)` resolves to an order from `src/lib/orders.mjs`, or `null`. It resolves to:

- `{ id, status, totalCents, orderedOn }` for an order whose `tenantId` and `email` match the session's. Return only these fields, because the customer can read whatever a tool returns.
- `{ error: "order not found" }` for every other order: another customer's, another shop's, or one that doesn't exist. They all get the same answer, so nobody can try order numbers to learn which exist.
- `{ error: "orderId must be an integer" }` when `args.orderId` isn't one.

**`runToolCall(call, session, tools, log)`**, in `src/tools.mjs`, runs one tool call from the model, such as `{ id: "call_A1", type: "function", function: { name: "get_order", arguments: '{"orderId":1042}' } }`. `tools` is a `Map` from a tool's name to a function `(args, session) => result`, and `log(message)` records what went wrong. It resolves to the tool message for the next request, `{ role: "tool", tool_call_id: call.id, content }`, where `content` is a JSON string:

- the tool's result, for a call that worked
- `{"error":"unknown tool: <name>"}` for a name that isn't in `tools`
- `{"error":"arguments are not valid JSON"}` when `JSON.parse` fails
- a safe error when the tool throws, such as `{"error":"the tool failed, try again later"}`. Pass the error's message to `log`, and keep it out of the content, so the model never sees your database's host name.

`GET_ORDER_TOOL`, the tool's definition for the request, is already in the file. It has no customer argument.

## Run the checks

```sh
npm run milestone -- 2
```

The checks use the dataset's orders from `data/orders.json`, so they need no database:

- marks a stream that ends without a finish event as interrupted
- keeps the usage unknown when the stream ends before its usage event
- stops at an error event, and skips event types it doesn't handle
- looks up the session customer's own order, with only the fields the answer needs
- answers another customer's order, another shop's, and a missing one the same way
- runs only the tools on its list
- answers every call with a tool message that names its id, failed calls too

## Hints

- Sections 2 and 3 of [Streaming](https://atomicly.dev/lessons/ai-stream-events), *Only a terminal event finishes the answer* and *Skip what you don't handle, stop on an error*, build `readStream` step by step.
- Section 2 of [Tool calling](https://atomicly.dev/lessons/ai-tool-contracts), *Identity comes from the session*, shows why `getOrder` compares the order with the session, never with an argument. Here a customer is an email in one shop. The same email can belong to a customer of both shops, so a Deskworks session with Chen Wei's email still can't see his Kettle & Co order 1042.
- Section 3 of the same lesson, *Check the call before you run it*, shows the dispatcher, and why a `Map` holds the tools: a plain object also finds `toString`.
- Section 2 of [The agent loop](https://atomicly.dev/lessons/ai-tool-transcript), *Answer every call, even the failed ones*, shows the safe error, and why each tool message copies its call's `id`.

## The solution

The `solutions` branch has every milestone built. This one is in [`src/stream.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/stream.mjs) and [`src/tools.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/tools.mjs).
