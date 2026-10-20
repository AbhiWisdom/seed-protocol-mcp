/**
 * Uniform MCP tool results: JSON text for every client + structuredContent
 * for clients that read it; errors carry a stable [CODE] prefix.
 */

export function ok(data, note) {
  const text = `${note ? `${note}\n\n` : ""}${JSON.stringify(data, null, 2)}`;
  return { content: [{ type: "text", text }], structuredContent: data };
}

export function fail(err) {
  const code = err?.code || "INTERNAL_ERROR";
  return { content: [{ type: "text", text: `Error [${code}]: ${err?.message || String(err)}` }], isError: true };
}

/** Wrap a handler so thrown errors become MCP error results, never crashes. */
export function safe(handler) {
  return async (args, extra) => {
    try {
      return await handler(args || {}, extra);
    } catch (err) {
      return fail(err);
    }
  };
}

/** Annotation presets (MCP tool hints). */
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
export const LOCAL_READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
