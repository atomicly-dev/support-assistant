// Milestone 2: streaming. See milestones/2-streaming-and-tools.md.
//
// The model client turns a provider's stream into typed events:
//   { type: "text", text }           a piece of the answer
//   { type: "finish", status }       the terminal event: "complete", "cut_off", "tool_call", "filtered", or "refused"
//   { type: "usage", input, output } the token counts, which can arrive after the finish, or never
//   { type: "error", message }       the provider failed after the stream started
// It can send other types too, such as "tool_calls" or "ping".

/**
 * Builds the answer from a stream's events.
 * Returns { status, text, usage, error }. The status stays "interrupted" until a finish event
 * arrives, an error event makes it "failed", and usage stays null until a usage event arrives.
 */
export async function readStream(events) {
  throw new Error("Not built yet: milestone 2");
}
