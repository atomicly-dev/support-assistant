# Milestone 5: Refunds

Lessons: [Human-in-the-loop approval: bind it to the action executed](https://atomicly.dev/lessons/ai-safe-actions) and [Prompt injection: retrieved text can contain hostile instructions](https://atomicly.dev/lessons/ai-prompt-injection)

## The situation

Chen Wei's kettle from order 1042 stopped heating. The assistant proposed a $40.00 refund, and Maya, a support agent, approved it. Then a later turn proposed $400.00 for the same order, and the shop paid that too, because the approval only said "order 1042 may get a refund". A client retry paid a third time.

And Kettle & Co's kettle care page has a customer's tip in it, chunk `kc-kettle-care-v1-2`, with an instruction for the assistant about order 1043, which is Dara Khan's. No prompt reliably stops a model from following text like that. Your code's checks have to hold whatever the model asks for.

## What you build

All three functions go in `src/refunds.mjs`. `desk` comes from `createDesk(findOrder)` in `src/lib/desk.mjs`: it holds `findOrder`, a `proposals` Map, an `approvals` Map, and a fake `ledger` whose `refund({ idempotencyKey, orderId, amountCents })` pays once per key and returns `{ refundId, orderId, amountCents }`.

**`proposeRefund(args, session, desk)`** is the model's only refund tool. It stores a proposal and pays nothing. `args` come from the model, and `session` is `{ tenantId, email }`, from the customer's login. It resolves to:

- `{ proposalId, status: "awaiting approval" }`, after it stores `{ orderId, amountCents }` in `desk.proposals` under a new id such as `"p_1"`
- `{ error: "order not found" }` for an order that isn't the session customer's in the session's shop, whatever the arguments say
- `{ error }` when `orderId` isn't an integer, or `amountCents` isn't a whole number from 1 to the order's `totalCents`

**`approve(proposalId, agent, now, desk)`** is a support agent's approval of one proposal. `agent` is `{ actorId }`, from the agent's login, and `now` is the time in milliseconds. It stores the approval in `desk.approvals` under a new id such as `"a_1"`, and returns `{ approvalId, args, actorId, expiresAt, idempotencyKey }`:

- `args`: a copy of the proposal's exact arguments
- `actorId`: the agent's, from `agent`
- `expiresAt`: `now + APPROVAL_MS`, 15 minutes later
- `idempotencyKey`: a random key, such as `randomUUID()` from `node:crypto`

It returns `{ error: "no such proposal" }` for an id it doesn't know.

**`executeRefund(command, agent, now, desk)`** pays an approved refund. `command` is `{ approvalId, args: { orderId, amountCents } }`. It checks the command in this order, and resolves to the first error:

1. `{ error: "no such approval" }`
2. `{ error: "approved by another agent" }`, when `agent.actorId` isn't the approval's. The actor comes from the login, never from the command.
3. `{ error: "approval expired" }`, from `expiresAt` on
4. `{ error: "arguments differ from the approval" }`, comparing `orderId` and `amountCents` by name

Then it pays the approval's arguments, not the command's, through `desk.ledger.refund` with the approval's idempotency key, and resolves to the ledger's refund. A retry finds the first refund and pays nothing new.

The file already has `APPROVAL_MS` and `PROPOSE_REFUND_TOOL`, the tool's definition for the request.

## Run the checks

```sh
npm run milestone -- 5
```

The checks use the dataset's orders, and replay the scripted transcripts in `tests/fixtures/injection-replays.json`: the tool calls a model could make after an injected instruction. No model runs:

- stores a proposal and pays nothing
- binds the approval to the proposal's exact arguments, the agent, an expiry, and a key
- refuses to pay an amount the approval didn't cover
- refuses an approval used by another agent or after it expires
- pays a retried command once, whatever order its fields come in
- fails every call of the replayed injection transcripts, and pays nothing

## Hints

- Section 2 of [Human-in-the-loop approval](https://atomicly.dev/lessons/ai-safe-actions), *Bind the approval to one exact command*, writes `proposeRefund`, `approve`, and `executeRefund`. This project's `proposeRefund` also checks the order's owner, as `getOrder` does in milestone 2.
- Section 2 of [Prompt injection](https://atomicly.dev/lessons/ai-prompt-injection), *Check the action, not the model*, shows a replay test, and section 3, *What a replay test proves*, says what it can't: how often a real model follows the tip. Add each new attack you find to the transcripts.

## The solution

The `solutions` branch has every milestone built. This one is in [`src/refunds.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/refunds.mjs).
