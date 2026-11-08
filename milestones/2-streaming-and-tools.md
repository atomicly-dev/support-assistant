# Milestone 2: Streaming and tools

Read this on atomicly, with the tutor next to it: [milestone 2 on atomicly](https://atomicly.dev/projects/proj-support-assistant/milestones/proj-support-m2).

Lessons: [Streaming: a partial answer isn't a finished answer](https://atomicly.dev/lessons/ai-stream-events), [Tool calling: a call is a request for your code to act](https://atomicly.dev/lessons/ai-tool-contracts), and [The agent loop: complete the tool exchange](https://atomicly.dev/lessons/ai-tool-transcript)

## The situation

A customer asks "Where is order 1042?" The assistant streams its answer, so the customer can read it as it arrives. It also gives the model a `get_order` tool to look the order up.

The first version got two things wrong. A dropped connection ended the stream just like a finished answer, so a customer saw half a sentence marked as done. And the tool took the customer's email as an argument, so anyone who typed someone else's email got that person's order.

## What you build

**`readStream(events)`**, in `src/stream.mjs`, builds the answer from a stream of events. `events` is an async iterable. The model client already turns the provider's chunks into these events:

- `{ type: "text", text }`: a piece of the answer
- `{ type: "finish", status }`: the terminal event, with a status like `readCompletion`'s, such as `"complete"` or `"cut_off"`
- `{ type: "usage", input, output }`: the token counts, which can arrive after the finish, or never
- `{ type: "error", message }`: the provider failed after the stream started
- other types, such as `ping` or `tool_calls`

`readStream` resolves to `{ status, text, usage, error }`:

- `status`: the finish event's status, `"interrupted"` when no finish event arrived, or `"failed"` after an error event
- `text`: the pieces of text, joined
- `usage`: `{ input, output }`, or `null` when no usage event arrived
- `error`: the error event's message, or `null`

**`getOrder(args, session, findOrder)`**, in `src/tools.mjs`, is the `get_order` tool:

- `args` come from the model, such as `{ orderId: 1042 }`.
- `session` is `{ tenantId, email }`, from the customer's login.
- `findOrder(orderId)` resolves to an order, `{ id, tenantId, email, status, totalCents, orderedOn }`, or to `null`.

`getOrder` resolves to `{ id, status, totalCents, orderedOn }`, or to `{ error: "order not found" }`.

**`runToolCall(call, session, tools, log)`**, in `src/tools.mjs`, runs one tool call from the model:

- `call` looks like `{ id: "call_A1", type: "function", function: { name: "get_order", arguments: '{"orderId":1042}' } }`. Its arguments are a JSON string.
- `tools` is a `Map` from a tool's name to a function `(args, session) => result`, which can be `async`. `src/assistant.mjs` puts `getOrder` in it, with `findOrder` already filled in.
- `log(line)` records what went wrong, so you can read it later.

`runToolCall` resolves to the tool message for the next request, `{ role: "tool", tool_call_id, content }`, where `content` is a JSON string:

| The call | `content` |
| --- | --- |
| The tool ran | the tool's result |
| Its name isn't in `tools` | `{"error":"unknown tool: <name>"}` |
| Its arguments aren't JSON | `{"error":"arguments are not valid JSON"}` |
| The tool threw | `{"error":"..."}`, with a safe message you pick |

`GET_ORDER_TOOL`, the tool's definition for the request, is already in the file. It has no customer argument.

## The rules

- Only a finish event finishes the answer. A stream that ends without one stays `"interrupted"`, with the text it got.
- Unknown usage isn't zero tokens. It stays `null`.
- An error event ends the answer. Nothing after it counts, not even a finish event.
- Skip any event type you don't handle. It isn't an error.
- `getOrder` returns only the session customer's own orders, with only the four fields the answer needs, because the customer can read whatever a tool returns.
- Every other order, another customer's or one that doesn't exist, gets the same `{ error: "order not found" }`, whatever's in the arguments. That way nobody can try order numbers to find out which ones exist.
- Only the tools in the `Map` run, even for a name such as `constructor`.
- The tool gets the `session` from the login, and never takes the customer from the arguments.
- Every call gets a tool message with its own `id`, failed calls too. A thrown error's details go to `log`, never to the model.

## The new cases

The company put an LLM gateway between the assistant and the provider. When the gateway retries a slow connection, it sends the last piece of text again, after the finish event and before the usage. One ticket's saved answer ended in "October 30. October 30." What should `readStream` return for that stream? The check "ends the text at the finish event, and still reads the usage after it" replays it.

Ana Silva buys from both shops with the same email. In her Deskworks session, which of her orders should `getOrder` find? The check "keeps one email's orders apart in each shop" tests this with a made-up Deskworks order.

## Run the checks

```sh
npm run milestone -- 2
```

These checks use the orders in `data/orders.json`, so you don't need the database:

- takes the status only from a finish event, so a dropped stream stays interrupted
- keeps the usage unknown when the stream ends before its usage event
- stops at an error event, and skips event types it doesn't handle
- ends the text at the finish event, and still reads the usage after it
- looks up the session customer's own order, with only the fields the answer needs
- answers another customer's order and a missing one the same way, whatever's in the arguments
- keeps one email's orders apart in each shop
- runs only the tools on its list
- passes the tool the login's session, whatever's in the arguments
- answers every call with a tool message for its id, failed calls too

## Hints

Stuck? The hints go from where the course teaches this, to the approach, to a detail people often get wrong.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Streaming](https://atomicly.dev/lessons/ai-stream-events): section 2, *Only a terminal event finishes the answer*, and section 3, *Skip what you don't handle, stop on an error*.
- [Tool calling](https://atomicly.dev/lessons/ai-tool-contracts): section 2, *Identity comes from the session*, and section 3, *Check the call before you run it*.
- [The agent loop](https://atomicly.dev/lessons/ai-tool-transcript): section 2, *Answer every call, even the failed ones*.

</details>

<details>
<summary>Hint 2: the approach</summary>

- `readStream`: start with the answer a dropped stream would get, and let each event type change only its own field. An error event ends the loop. A finish event doesn't, because the usage can still arrive, but no text after it counts.
- `getOrder`: look the order up by its id, then check that it's the session customer's. The session has two fields, and both matter. Copy the four fields into a new object.
- `runToolCall`: check the name, then parse the arguments, then run the tool. Each step can fail in its own way. Build every message in one place, so each one gets the call's `id`.

</details>

<details>
<summary>Hint 3: a detail that's easy to get wrong</summary>

A tool can be `async`, as `getOrder` is. Without `await`, `JSON.stringify` gets a Promise and writes `{}`, and a `try` around the call doesn't catch the tool's error.

</details>

## The solution

On the `solutions` branch, this milestone's code is in [`src/stream.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/stream.mjs) and [`src/tools.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/tools.mjs).
