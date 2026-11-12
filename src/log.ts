import type { ListenerStatus, ListenersStatus } from "./core/http";

function endpoint(status: ListenerStatus, suffix: string): string {
  return `http://${status.host}:${status.port}${suffix}`;
}

function logListener(label: string, status: ListenerStatus, suffix: string): void {
  const url = endpoint(status, suffix);
  if (!status.enabled) {
    console.log(`[lm-computer] ${label} disabled`);
    return;
  }
  if (status.listening) {
    console.log(`[lm-computer] ${label} listening on ${url}`);
    return;
  }
  console.error(
    `[lm-computer] ${label} failed on ${url}: ${status.error ?? "unknown error"}`,
  );
}

/** Prints one line per listener so a busy port is visible in the LM Studio log. */
export function logListeners(listeners: ListenersStatus): void {
  logListener("REST API", listeners.api, "");
  logListener("MCP", listeners.mcp, "/mcp");
}
