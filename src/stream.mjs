// Milestone 2: streaming. See milestones/2-streaming-and-tools.md.
//
// The model client turns a provider's stream into typed events:
//   { type: "text", text }           a piece of the answer
//   { type: "finish", status }       the terminal event: "complete", "cut_off", "tool_call", "filtered", "refused", or "unknown"
//   { type: "usage", input, output } the token counts, which can arrive after the finish, or never
//   { type: "error", message }       the provider failed after the stream started
// It can send other types too, such as "tool_calls" or "ping".

/**
 * Builds the answer from a stream's events, an async iterable.
 * Resolves to { status, text, usage, error }: status is the finish event's, "interrupted" without
 * one, or "failed" after an error event. usage is null when no usage event arrived.
 */
export async function readStream(events) {
  const answer = { status: "interrupted", text: "", usage: null, error: null };
  let finished = false;
  for await (const event of events) {
    if (event.type === "text" && !finished) answer.text += event.text; // text after the finish isn't part of the answer
    else if (event.type === "finish") {
      answer.status = event.status;
      finished = true; // keep reading: the usage can still come
    } else if (event.type === "usage") answer.usage = { input: event.input, output: event.output };
    else if (event.type === "error") {
      answer.status = "failed";
      answer.error = event.message;
      break;
    } // any other type: skip it
  }
  return answer;
}
