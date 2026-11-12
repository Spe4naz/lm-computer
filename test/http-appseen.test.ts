import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComputerService } from "../src/core/service";
import { freePort } from "./helpers";

const token = "app-seen-token";

let home: string;
let workspace: string;
let service: ComputerService;
let apiPort: number;
let mcpPort: number;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "lmc-seen-home-"));
  workspace = await mkdtemp(path.join(os.tmpdir(), "lmc-seen-ws-"));
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
      shellEnabled: false,
      approvalTimeoutSec: 5,
      shellTimeoutSec: 10,
      maxOutputBytes: 64 * 1024,
      autoAcceptMaxSec: 0,
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

describe("app heartbeat", () => {
  it("does not treat MCP traffic as the LM Chat app", async () => {
    expect(service.isAppActive()).toBe(false);

    const res = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
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
    expect(service.isAppActive()).toBe(false);
  });

  it("treats authenticated REST traffic as the app", async () => {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(service.isAppActive()).toBe(true);
  });
});
