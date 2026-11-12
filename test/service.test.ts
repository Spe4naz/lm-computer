import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComputerService } from "../src/core/service";

let home: string;
let workspace: string;
let service: ComputerService;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "lmc-service-home-"));
  workspace = await mkdtemp(path.join(os.tmpdir(), "lmc-service-ws-"));
  service = await ComputerService.create({
    homeDir: home,
    config: {
      workspace,
      host: "127.0.0.1",
      port: 1236,
      token: "test-token",
      shellEnabled: true,
      approvalTimeoutSec: 5,
      shellTimeoutSec: 10,
      maxOutputBytes: 64 * 1024,
      autoAcceptMaxSec: 1800,
      zenityFallback: false,
    },
  });
});

afterAll(async () => {
  await service.stopHttp();
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("ComputerService tools", () => {
  it("writes, reads, lists and searches files", async () => {
    const write = await service.executeTool(
      "fs_write",
      { path: "notes/a.txt", content: "hello world" },
      { origin: "api" },
    );
    expect(write.text).toContain("Created");

    const read = await service.executeTool(
      "fs_read",
      { path: "notes/a.txt" },
      { origin: "api" },
    );
    expect((read.data as { content: string }).content).toBe("hello world");

    const list = await service.executeTool("fs_list", { path: "notes" }, { origin: "api" });
    expect(list.text).toContain("notes/a.txt");

    const search = await service.executeTool(
      "fs_search",
      { query: "world", glob: "**/*.txt" },
      { origin: "api" },
    );
    expect(search.text).toContain("notes/a.txt");
  });

  it("moves deleted files to trash", async () => {
    await service.executeTool(
      "fs_write",
      { path: "notes/b.txt", content: "remove me" },
      { origin: "api" },
    );
    service.markAppSeen();
    service.setAutoAccept(60);
    const deleted = await service.executeTool(
      "fs_delete",
      { path: "notes/b.txt" },
      { origin: "api" },
    );
    expect(deleted.text).toContain("trash");
  });

  it("runs shell commands with auto-accept", async () => {
    service.markAppSeen();
    service.setAutoAccept(60);
    const result = await service.executeTool(
      "shell_run",
      { command: "echo hi" },
      { origin: "api" },
    );
    expect(result.text).toContain("Exit code: 0");
    expect(result.text).toContain("hi");
    expect((result.data as { exitCode: number }).exitCode).toBe(0);
  });

  it("records tool calls in the audit log", () => {
    const entries = service.audit.tail(20);
    expect(entries.some((entry) => entry.tool === "shell_run")).toBe(true);
    expect(entries.some((entry) => entry.tool === "fs_delete")).toBe(true);
  });
});
