# Support assistant

A project for the [AI engineering course](https://atomicly.dev/courses/ai-engineering) on [atomicly](https://atomicly.dev). You build a support assistant for two online shops, milestone by milestone, on your own machine: it answers from each shop's help pages, looks up a customer's orders, and proposes refunds an agent approves. Each milestone applies a few lessons from the course, and has checks that tell you when it works.

## The brief

The platform runs one support assistant for two shops:

- **Kettle & Co** (`kettleandco`) sells kitchenware: kettles, mugs, toasters, and coffee grinders.
- **Deskworks** (`deskworks`) sells home office furniture and supplies.

Their help pages share one table of chunks, and their orders share one orders table. A third shop, Lampworks, joins later, so nothing can assume two.

The assistant must:

- Answer policy questions from each shop's own help pages, with citations.
- Look up a customer's own orders, and nobody else's.
- Propose refunds, which a support agent approves before anything is paid.
- Keep each trial user within a daily allowance of 50 cents of model calls.

The steps are known for each kind of question, so it's a workflow, not an agent. Each boundary is code at a fixed place you can test, never a rule in the prompt. The model is GPT-6 Luna, and the help pages are in PostgreSQL with pgvector, with real embeddings. All the shops' data is made up.

## What you need

- Node.js 24 or later, with npm.
- Docker, or Podman with `podman compose`, for PostgreSQL. Milestone 3, `npm run eval`, and `npm run ask` need it.
- Git, and a GitHub account for your copy of this repo.
- An OpenAI API key, only if you want to run the assistant with a real model. The checks never need one.

## Start

1. On GitHub, click **Use this template**, then **Create a new repository**. It can be public or private.
2. Clone your new repo, and set it up:

```sh
git clone https://github.com/<you>/<your-repo>.git support-assistant
cd support-assistant
npm install
docker compose up -d --wait
npm run setup
npm run milestone -- all
```

`npm run setup` loads the course's dataset into the database: both shops' help pages, with one embedding per chunk, the labeled questions, and the orders. You can run it again at any time. The database keeps its data in memory, so after `docker compose down` or a restart, run `npm run setup` again. With Podman, run `podman compose up -d --wait` in place of the `docker compose` line.

On a fresh copy, every check fails with "Not built yet". That's the starting point.

## The milestones

Each milestone has a page with the situation, the functions to write with their exact inputs and outputs, and the lessons it uses. Every function to write throws `Not built yet: milestone <n>` until you write it. The rest of each file, and everything in `src/lib/`, is plumbing you don't need to change.

| Milestone | You write | Command |
| --- | --- | --- |
| [1. The model boundary](milestones/1-model-boundary.md) | `src/model.mjs` | `npm run milestone -- 1` |
| [2. Streaming and tools](milestones/2-streaming-and-tools.md) | `src/stream.mjs`, `src/tools.mjs` | `npm run milestone -- 2` |
| [3. Retrieval](milestones/3-retrieval.md) | `src/retrieval.mjs` | `npm run milestone -- 3` |
| [4. Evals](milestones/4-evals.md) | `src/evals.mjs` | `npm run milestone -- 4` |
| [5. Refunds](milestones/5-refunds.md) | `src/refunds.mjs` | `npm run milestone -- 5` |
| [6. Budgets and traces](milestones/6-budgets-and-traces.md) | `src/budget.mjs`, `src/trace.mjs` | `npm run milestone -- 6` |

Do them in order, or in any order you like: each milestone's checks need only that milestone's code, and get what they'd need from earlier milestones from fixtures in `tests/fixtures/`.

## How the checks work

`npm run milestone -- 3` runs milestone 3's tests, in `tests/m3.test.mjs`, and prints each check by name, with what came back and what should have when it fails. `npm run milestone -- all` runs all six. The tests use a fake model with made-up replies, in `src/lib/fake-model.mjs`, so they pass the same way every time, cost nothing, and make no network call.

Each push to your repo runs the same checks on GitHub Actions, in `.github/workflows/milestones.yml`: one job per milestone, named `milestone-1` to `milestone-6`. Milestone 3's job starts PostgreSQL first.

On the project's page on atomicly, paste your repo's URL once. atomicly reads those checks from GitHub, and marks a milestone passed from the first commit that passes it. It sees only whether each check passed. It matches the checks by their names, so keep the job names as they are. atomicly can't read the checks of a private repo, so for one, you tick each milestone yourself on the page.

`.github/workflows/template-ci.yml` is the template's own check, for its maintainers. It never runs in your copy.

## Ask with a real model

Once every milestone passes, you can run the whole assistant with GPT-6 Luna and your own OpenAI API key. You pay OpenAI for the calls, and the key never leaves your machine:

```sh
export OPENAI_API_KEY=sk-...
npm run ask -- "Where is order 1042?" --live
npm run ask -- "How many days do I have to ask for a refund?" --live
npm run ask -- "Please refund order 1042, my kettle stopped heating" --live
npm run ask -- "How long do I have to return a desk lamp for a refund?" --live --shop deskworks --customer pia.lund@example.com
```

In place of the `export` line, you can put `OPENAI_API_KEY=sk-...` in a file named `.env` in this folder. Git ignores that file, so your key stays out of your commits. Without a key, `ask` says how to set one and stops.

`--shop` and `--customer` set the session, as a login would: the shop is `kettleandco` or `deskworks`, and the customer is an email from `data/orders.json`. By default, you're Chen Wei, `chen.wei@example.com`, who placed order 1042 at Kettle & Co. Try asking about order 1043, which is someone else's.

`ask` runs the workflow in `src/assistant.mjs` with your code from every milestone. It routes the message, then answers a policy question from the shop's help pages, or lets the model look up the order and propose a refund. It prints the answer as it arrives, then the request's trace, with its cost and the budget. The budget lives in memory, so each `ask` starts with an empty one.

`npm run eval -- --live` runs the answer eval with the real model too. See [milestone 4](milestones/4-evals.md#the-score-to-beat).

## The solutions branch

The `solutions` branch has every milestone built, the way the lessons write the code. Compare your code with it once your checks pass, or when you're stuck. A copy made with **Use this template** has only `main`, unless you ticked **Include all branches**. You can always read it [on GitHub](https://github.com/atomicly-dev/support-assistant/tree/solutions).

## What's in the repo

- `src/`: the files you edit, one or two per milestone, and `src/assistant.mjs`, the workflow `ask` runs.
- `src/lib/`: the plumbing: the database helper, the orders, the fake and live model clients, the prices, and the support desk.
- `tests/`: one test file per milestone, and the fixtures they use.
- `milestones/`: one page per milestone.
- `evals/`: the labeled answer cases, and the baseline `npm run eval` compares with.
- `data/`: a copy of the course's dataset: `ai-support.sql` loads the help pages, the questions, and the shops' orders, refunds, and tickets, and `orders.json` holds the same orders for the tests.
- `scripts/`: the commands behind `npm run`.
- `milestones.json`: each milestone's checks, lessons, and files, which atomicly imports.

When you're done, stop the database with `docker compose down`.

## License

MIT. See [LICENSE](LICENSE).
