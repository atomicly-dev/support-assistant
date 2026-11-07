# Milestone 5: Refunds

Lessons: [Human-in-the-loop approval: bind it to the action executed](https://atomicly.dev/lessons/ai-safe-actions) and [Prompt injection: retrieved text can contain hostile instructions](https://atomicly.dev/lessons/ai-prompt-injection)

## The situation

Ana Silva's toaster from order 1040 stopped working. The assistant proposed a $35.00 refund, and Priya, a support agent, approved it. Then a later turn proposed the full $89.00 for the same order, and the shop paid that too, because the approval only said "order 1040 may get a refund". A client retry paid a third time.

And Kettle & Co's kettle care page has a customer's tip in it, chunk `kc-kettle-care-v1-2`, with an instruction for the assistant about order 1043, which is Dara Khan's. No prompt reliably stops a model from following text like that. Your code's checks have to hold whatever the model asks for.

## What you build

All three functions go in `src/refunds.mjs`. The file already has `APPROVAL_MS`, 15 minutes, and `PROPOSE_REFUND_TOOL`, the tool's definition for the request.

`desk` comes from `createDesk(findOrder)` in `src/lib/desk.mjs`. It holds:

- `findOrder(orderId)`, which resolves to an order, `{ id, tenantId, email, status, totalCents, orderedOn }`, or to `null`
- `proposals`, an empty `Map` for the proposals: a proposal's id to `{ orderId, amountCents }`
- `approvals`, an empty `Map` for the approvals: an approval's id to `{ args, actorId, expiresAt, idempotencyKey }`, and anything else you store
- `ledger`, a fake ledger. `ledger.refund({ idempotencyKey, orderId, amountCents })` pays a refund and resolves to `{ refundId, orderId, amountCents }`. For a key it has seen, it resolves to the first refund and pays nothing new. `ledger.refunds` holds what it paid.

**`proposeRefund(args, session, desk)`** is the model's only refund tool. `args` come from the model, such as `{ orderId: 1040, amountCents: 3500 }`, and `session` is `{ tenantId, email }`, from the customer's login. It resolves to:

- `{ proposalId, status: "awaiting approval" }`, after it stores the proposal under a new id, such as `"p_1"`
- `{ error: "order not found" }` for an order that isn't the session customer's
- `{ error }`, with a message you pick, for an amount that doesn't fit the order

**`approve(proposalId, agent, now, desk)`** is a support agent's approval of one proposal. `agent` is `{ actorId }`, from the agent's login, and `now` is the time in milliseconds. It stores the approval under a new id, such as `"a_1"`, and returns `{ approvalId, args, actorId, expiresAt, idempotencyKey }`:

- `args`: the proposal's arguments
- `actorId`: the agent's
- `expiresAt`: `now + APPROVAL_MS`
- `idempotencyKey`: a random string, such as `randomUUID()` from `node:crypto`

For an id it doesn't know, it returns `{ error: "no such proposal" }`.

**`executeRefund(command, agent, now, desk)`** pays an approved refund. `command` is `{ approvalId, args: { orderId, amountCents } }`. It resolves to the ledger's refund, or to an error:

| When | It resolves to |
| --- | --- |
| no approval has that id | `{ error: "no such approval" }` |
| `agent.actorId` isn't the approval's | `{ error: "approved by another agent" }` |
| `now` is at or after `expiresAt` | `{ error: "approval expired" }` |
| the command's `orderId` or `amountCents` isn't the approval's | `{ error: "arguments differ from the approval" }` |

## The rules

- A proposal pays nothing.
- Only the session customer's own order in the session's shop can get a proposal, whatever the arguments say. Every other order gets `{ error: "order not found" }`.
- A refund is a whole number of cents, from 1 to the order's `totalCents`.
- An approval keeps its own copy of the arguments the agent saw. A later change to the proposal doesn't change it.
- Each approval gets its own random key, even for the same arguments.
- The agent comes from the login, never from the command.
- From `expiresAt` on, an approval no longer works.
- `executeRefund` pays the approval's arguments, and compares them with the command's field by field, so the order of the fields doesn't matter.
- A retried command pays nothing new.
- Every call in the replayed injection transcripts fails, and pays nothing.

## The new case

Priya's click on "Approve" went through twice, and then Sam approved the same proposal too. Each of them ran the command they got. How many refunds did the ledger pay, and why didn't the idempotency key stop them? Make the ledger pay once: the second and third approvals fail, with an error you choose. The check **approves each proposal once, so a double approval can't pay twice** replays the clicks.

## Run the checks

```sh
npm run milestone -- 5
```

The checks use the dataset's orders. They also replay the scripted transcripts in `tests/fixtures/injection-replays.json`: the tool calls a model could make after an injected instruction, in Chen Wei's session. No model runs, and they need no database:

- stores a proposal and pays nothing
- proposes only the customer's own order, for 1 cent up to its total
- binds the approval to a copy of the proposal's arguments, the agent, an expiry, and a key
- refuses to pay an order or an amount the approval didn't cover
- refuses an unknown approval, another agent's, or an expired one
- pays a retried command once, whatever order its fields come in
- approves each proposal once, so a double approval can't pay twice
- fails every call of the replayed injection transcripts, and pays nothing

## Hints

Open them one at a time, when you're stuck.

<details>
<summary>Hint 1: where the course teaches it</summary>

- [Human-in-the-loop approval](https://atomicly.dev/lessons/ai-safe-actions): section 2, *Bind the approval to one exact command*.
- [Prompt injection](https://atomicly.dev/lessons/ai-prompt-injection): section 2, *Check the action, not the model*, and section 3, *What a replay test proves*.
- `proposeRefund` checks the order's owner the way `getOrder` does in [milestone 2](2-streaming-and-tools.md).

</details>

<details>
<summary>Hint 2: the approach</summary>

- `proposeRefund`: find the order, check its owner against the session, then check the amount against the order's total. Store the proposal only when every check passes.
- `approve`: find the proposal, and look for an approval of it in `desk.approvals`. Then store a new approval with a copy of the proposal's arguments.
- `executeRefund`: each check returns its error before anything is paid. Then pay with the approval's key and the approval's arguments.

</details>

<details>
<summary>Hint 3: details that are easy to get wrong</summary>

- `{ ...proposal }` makes a copy. `args: proposal` shares the object, so a change to one shows in the other.
- `Number.isInteger("3500")` and `Number.isInteger(35.5)` are both `false`, so one call checks the type and the whole number.

</details>

## The solution

The `solutions` branch has every milestone built. This one is in [`src/refunds.mjs`](https://github.com/atomicly-dev/support-assistant/blob/solutions/src/refunds.mjs).
