import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComputerService } from "../src/core/service";
import { freePort, waitFor } from "./helpers";

const token = "split-port-token";

let home: string;
let workspace: string;
let service: ComputerService;
let apiPort: number;
let mcpPort: number;

const apiUrl = (route: string): string => `http://127.0.0.1:${apiPort}${route}`;
const mcpUrl = (route: string): string => `http://127.0.0.1:${mcpPort}${route}`;
const auth = { Authorization: `Bearer ${token}` };

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "lmc-http-home-"));
  workspace = await mkdtemp(path.join(os.tmpdir(), "lmc-http-ws-"));
  apiPort = await freePort();
  mcpPort = await freePort();
  service = await ComputerService.create({
    homeDir: home,
    config: {
      workspace,
      host: "127.0.0.1",
      port: apiPort,
      mcpHost: "127.0.0.1",
      mcpPort,
      token,
      shellEnabled: true,
      approvalTimeoutSec: 5,
      shellTimeoutSec: 10,
      maxOutputBytes: 64 * 1024,
      autoAcceptMaxSec: 1800,
      zenityFallback: false,
    },
  });
  await service.startHttp();
});

afterAll(async () => {
  await service.stopHttp();
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("split listeners", () => {
  it("starts REST and MCP on different ports", async () => {
    const status = service.status();
    expect(status.listeners.api.listening).toBe(true);
    expect(status.listeners.mcp.listening).toBe(true);
    expect(status.listeners.api.port).toBe(apiPort);
    expect(status.listeners.mcp.port).toBe(mcpPort);
  });

  it("serves /api/status only on the REST port", async () => {
    const res = await fetch(apiUrl("/api/status"), { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      listeners: { api: { listening: boolean }; mcp: { listening: boolean } };
    };
    expect(body.listeners.api.listening).toBe(true);
    expect(body.listeners.mcp.listening).toBe(true);

    const notHere = await fetch(mcpUrl("/api/status"), { headers: auth });
    expect(notHere.status).toBe(404);
  });

  it("keeps the minimal health check on both ports", async () => {
    for (const url of [apiUrl("/api/health"), mcpUrl("/api/health")]) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    }
  });

  it("rejects /mcp on the REST port with a hint", async () => {    const res = await fetch(apiUrl("/mcp"), {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; mcpPort: number };
    expect(body.error).toContain("MCP");
    expect(body.mcpPort).toBe(mcpPort);
  });

  it("handles MCP initialize on the MCP port", async () => {
    const res = await fetch(mcpUrl("/mcp"), {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(body.result?.serverInfo?.name).toBe("lm-computer");
  });

  it("does not reflect CORS for an arbitrary origin", async () => {
    const res = await fetch(apiUrl("/api/health"), {
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a workspace outside the allowed roots", async () => {
    const root = path.parse(workspace).root;
    const res = await fetch(apiUrl("/api/config"), {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: root }),
    });
    expect(res.status).toBe(400);
  });

  it("stops every listener through the MCP port", async () => {
    const res = await fetch(mcpUrl("/api/shutdown"), { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    await waitFor(() => {
      const listeners = service.status().listeners;
      return !listeners.api.listening && !listeners.mcp.listening;
    });
  });
});
