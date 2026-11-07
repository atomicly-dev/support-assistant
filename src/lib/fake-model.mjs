// A fake model client for the tests, and for your own experiments. It never calls a provider, so it
// needs no key and answers the same way every time. You don't need to change this file.
//
// It has the same methods as the live client in src/lib/openai.mjs:
//   complete(request)       resolves to the next reply in `replies`, a result like
//                           { status: "complete", text: "...", usage: { input: 212, output: 18 } }.
//                           A reply that's an Error is thrown instead, like a failed call.
//   stream(request)         yields the next list in `streams`, one typed event at a time, such as
//                           { type: "text", text: "..." }, { type: "finish", status: "complete" }.
//   worstCaseCents(request) the most a call can cost, 15 cents unless you set `worstCaseCents`.
//   costCents(usage)        what a call cost, from its usage: 1 cent per 100 tokens here.
// Every call waits one turn of the event loop first, like a network round trip, and the client
// records each request in `requests`.

const turn = () => new Promise((resolve) => setImmediate(resolve));

export function fakeModel({ replies = [], streams = [], worstCaseCents = 15 } = {}) {
  const model = {
    requests: [],
    async complete(request) {
      model.requests.push(request);
      await turn();
      if (replies.length === 0) throw new Error("The fake model has no reply left for this call.");
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return structuredClone(reply);
    },
    async *stream(request) {
      model.requests.push(request);
      if (streams.length === 0) throw new Error("The fake model has no stream left for this call.");
      for (const event of streams.shift()) {
        await turn();
        yield structuredClone(event);
      }
    },
    worstCaseCents: () => worstCaseCents,
    costCents: (usage) => (usage.input + usage.output) / 100,
  };
  return model;
}
