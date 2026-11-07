// The live model client, for `npm run ask -- "..." --live` and `npm run eval -- --live`. It calls
// OpenAI's Chat Completions API with GPT-6 Luna and your own key, and has the same methods as the
// fake model in ./fake-model.mjs. The tests never use it. You don't need to change this file.
//
// complete() reads each response with your readCompletion from milestone 1. It never retries: a
// second attempt could be a second charge.

import { readCompletion } from "../model.mjs";
import { estimatedUsd, maxInputTokens, usageUsd } from "./prices.mjs";

export const MODEL = "gpt-6-luna";
// The dataset's chunks and questions were embedded with this model, at 256 dimensions, so a live
// question has to be too.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 256;

// OPENAI_BASE_URL can point the client at another server with the same API.
const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const TIMEOUT_MS = 60_000;

const FINISH = new Map([
  ["stop", "complete"],
  ["length", "cut_off"],
  ["tool_calls", "tool_call"],
  ["content_filter", "filtered"],
]);

export function openaiModel(apiKey) {
  async function post(path, body) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(`OpenAI answered ${response.status}${detail?.error?.message ? `: ${detail.error.message}` : ""}`);
    }
    return response;
  }
  const chat = (request) => ({ model: MODEL, reasoning_effort: "none", store: false, ...request });

  return {
    async complete(request) {
      const response = await post("/chat/completions", chat(request));
      return readCompletion(await response.json());
    },
    async *stream(request) {
      const response = await post("/chat/completions", { ...chat(request), stream: true, stream_options: { include_usage: true } });
      yield* toEvents(dataLines(response.body));
    },
    async embed(text) {
      const response = await post("/embeddings", { model: EMBEDDING_MODEL, input: text, dimensions: EMBEDDING_DIMENSIONS });
      return (await response.json()).data[0].embedding;
    },
    worstCaseCents: (request) => estimatedUsd({ input: maxInputTokens(request), maxOutput: request.max_completion_tokens }) * 100,
    costCents: (usage) => usageUsd(usage) * 100,
  };
}

// The parsed `data:` lines of a server-sent event stream, and "[DONE]" for the last one.
async function* dataLines(body) {
  let buffer = "";
  for await (const text of body.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      yield data === "[DONE]" ? data : JSON.parse(data);
    }
  }
}

// Turns Chat Completions chunks into the typed events src/stream.mjs reads. A reply's tool calls
// arrive in pieces, so they're put together and sent as one "tool_calls" event before the finish.
async function* toEvents(chunks) {
  let refused = false;
  const calls = [];
  for await (const chunk of chunks) {
    if (chunk === "[DONE]") return;
    if (chunk.error) {
      yield { type: "error", message: chunk.error.message ?? "the provider failed" };
      return;
    }
    if (chunk.usage) yield { type: "usage", input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.delta?.refusal) refused = true;
    if (choice.delta?.content) yield { type: "text", text: choice.delta.content };
    for (const piece of choice.delta?.tool_calls ?? []) {
      const call = (calls[piece.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (piece.id) call.id = piece.id;
      if (piece.function?.name) call.function.name += piece.function.name;
      if (piece.function?.arguments) call.function.arguments += piece.function.arguments;
    }
    if (choice.finish_reason) {
      if (calls.length > 0) yield { type: "tool_calls", calls };
      yield { type: "finish", status: refused ? "refused" : (FINISH.get(choice.finish_reason) ?? "unknown") };
    }
  }
}
