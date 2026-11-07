// What a GPT-6 Luna call costs. The live client and the traces use these. You don't need to change
// this file.

// GPT-6 Luna's prices in US dollars per 1 million tokens, from OpenAI's model page, checked
// 2026-11-05, with the default 30-minute cache. A request over 272K input tokens costs more, and
// this project's requests stay far below that.
export const PRICE = { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 };

/** The cost of a call from its usage, in US dollars. Usage without cache counts reads and writes none. */
export const usageUsd = ({ input, cached = 0, written = 0, output }) =>
  ((input - cached - written) * PRICE.input + cached * PRICE.cachedInput + written * PRICE.cacheWrite + output * PRICE.output) / 1e6;

/** A call's worst case in US dollars: all its input at the highest input price, and its maximum output. */
export const estimatedUsd = ({ input, maxOutput }) => (input * PRICE.cacheWrite + maxOutput * PRICE.output) / 1e6;

/**
 * The most input tokens a request can count. A token always covers at least one byte of text, so the
 * request's bytes are an upper bound. Each message adds a few tokens of its own, counted here as 10.
 * It's an overestimate on purpose: a reservation must never be less than the call can cost.
 */
export function maxInputTokens(request) {
  const { messages = [], tools = [], response_format: format = null } = request;
  return Buffer.byteLength(JSON.stringify({ messages, tools, format })) + 10 * messages.length;
}
