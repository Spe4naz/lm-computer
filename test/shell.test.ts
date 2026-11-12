import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertSafeCommand,
  DangerousCommandError,
  runShell,
} from "../src/core/shell";

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "lmc-shell-"));
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("command policy", () => {
  it("blocks privilege escalation and destructive commands", () => {
    for (const command of [
      "sudo apt update",
      "echo ok && sudo rm file",
      "mkfs.ext4 /dev/sda1",
      "dd if=/dev/zero of=/dev/sda",
      "shutdown -h now",
      "rm -rf /",
    ]) {
      expect(() => assertSafeCommand(command), command).toThrow(DangerousCommandError);
    }
  });

  it("allows ordinary commands", () => {
    expect(() => assertSafeCommand("echo hello")).not.toThrow();
    expect(() => assertSafeCommand("git status")).not.toThrow();
    expect(() => assertSafeCommand("node --version")).not.toThrow();
  });
});

describe("runShell", () => {
  it("captures stdout and exit code", async () => {
    const result = await runShell({
      command: "echo hello",
      cwd,
      timeoutSec: 10,
      maxOutputBytes: 64 * 1024,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hello");
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it("returns a non-zero exit code", async () => {
    const result = await runShell({
      command: "exit 3",
      cwd,
      timeoutSec: 10,
      maxOutputBytes: 64 * 1024,
    });
    expect(result.exitCode).toBe(3);
  });
});
