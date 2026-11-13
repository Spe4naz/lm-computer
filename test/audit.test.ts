import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AuditLog } from "../src/core/audit";

let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "lmc-audit-"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("AuditLog", () => {
  it("masks credentials inside commands and arguments", async () => {
    const file = path.join(home, "audit.jsonl");
    const log = new AuditLog(file);
    await log.append({
      tool: "shell_run",
      origin: "mcp",
      args: {
        command:
          "curl -H 'Authorization: Bearer supersecret' --password hunter2 https://user:pw@example.com",
      },
      decision: "allowed",
      ok: true,
      ms: 1,
    });

    const text = await readFile(file, "utf8");
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("user:pw");
    expect(text).toContain("Authorization: Bearer ***");
  });

  it("masks object keys that look secret", async () => {
    const file = path.join(home, "keys.jsonl");
    const log = new AuditLog(file);
    await log.append({
      tool: "config",
      origin: "api",
      args: { apiKey: "plain-secret", bridgeToken: "second-secret" },
      decision: "not-required",
      ok: true,
      ms: 1,
    });

    const text = await readFile(file, "utf8");
    expect(text).not.toContain("plain-secret");
    expect(text).not.toContain("second-secret");
  });
});
