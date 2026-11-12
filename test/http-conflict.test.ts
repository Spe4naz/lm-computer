import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComputerService } from "../src/core/service";
import { freePort } from "./helpers";

const token = "conflict-token";
const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const run of cleanup.reverse()) await run();
});

async function occupiedPort(): Promise<number> {
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  cleanup.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return port;
}

async function createService(apiPort: number, mcpPort: number): Promise<ComputerService> {
  const home = await mkdtemp(path.join(os.tmpdir(), "lmc-conflict-home-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "lmc-conflict-ws-"));
  cleanup.push(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  });
  return ComputerService.create({
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
}

describe("independent listeners", () => {
  it("keeps REST running when the MCP port is busy", async () => {
    const apiPort = await freePort();
    const mcpPort = await occupiedPort();
    const service = await createService(apiPort, mcpPort);
    cleanup.push(() => service.stopHttp());

    const listeners = await service.startHttp();
    expect(listeners.api.listening).toBe(true);
    expect(listeners.mcp.listening).toBe(false);
    expect(listeners.mcp.error).toMatch(/EADDRINUSE/);

    const res = await fetch(`http://127.0.0.1:${apiPort}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("keeps MCP running when the REST port is busy", async () => {
    const apiPort = await occupiedPort();
    const mcpPort = await freePort();
    const service = await createService(apiPort, mcpPort);
    cleanup.push(() => service.stopHttp());

    const listeners = await service.startHttp();
    expect(listeners.api.listening).toBe(false);
    expect(listeners.api.error).toMatch(/EADDRINUSE/);
    expect(listeners.mcp.listening).toBe(true);

    const res = await fetch(`http://127.0.0.1:${mcpPort}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("refuses to reuse the REST port for MCP", async () => {
    const port = await freePort();
    const service = await createService(port, port);
    cleanup.push(() => service.stopHttp());

    const listeners = await service.startHttp();
    expect(listeners.api.listening).toBe(true);
    expect(listeners.mcp.listening).toBe(false);
    expect(listeners.mcp.error).toContain("must differ");
  });
});
