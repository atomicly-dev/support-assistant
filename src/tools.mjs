// Milestone 2: tools. See milestones/2-streaming-and-tools.md.
//
// A tool call is a request for your code to act. getOrder is the order lookup the model can ask for,
// and runToolCall is the dispatcher that checks and runs each call.

// The tool as the model sees it. Its only argument is the order: the customer comes from the session.
export const GET_ORDER_TOOL = {
  type: "function",
  function: {
    name: "get_order",
    description: "Look up the status, total, and order date of one of the customer's own orders.",
    strict: true,
    parameters: {
      type: "object",
      properties: { orderId: { type: "integer" } },
      required: ["orderId"],
      additionalProperties: false,
    },
  },
};

/**
 * The get_order tool. `args` come from the model, `session` from the customer's login:
 * { tenantId, email }. `findOrder(orderId)` resolves to an order, or null.
 * Resolves to { id, status, totalCents, orderedOn } for the session customer's own order, and to
 * { error: "order not found" } for any other order.
 */
export async function getOrder({ orderId }, session, findOrder) {
  const order = await findOrder(orderId);
  if (!order || order.tenantId !== session.tenantId || order.email !== session.email) return { error: "order not found" };
  return { id: order.id, status: order.status, totalCents: order.totalCents, orderedOn: order.orderedOn };
}

/**
 * Runs one tool call from the model, such as
 * { id: "call_A1", type: "function", function: { name: "get_order", arguments: '{"orderId":1042}' } }.
 * `tools` is a Map from a tool's name to a function (args, session) => result. `log(message)` records
 * what went wrong.
 * Resolves to the tool message for the next request: { role: "tool", tool_call_id, content }, where
 * content is the result as a JSON string, or a JSON error the model can read.
 */
export async function runToolCall(call, session, tools, log) {
  const reply = (content) => ({ role: "tool", tool_call_id: call.id, content: JSON.stringify(content) });
  const tool = tools.get(call.function.name);
  if (!tool) return reply({ error: `unknown tool: ${call.function.name}` });
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return reply({ error: "arguments are not valid JSON" });
  }
  try {
    return reply(await tool(args, session));
  } catch (error) {
    log(`${call.id} failed: ${error.message}`);
    return reply({ error: "the tool failed, try again later" });
  }
}
