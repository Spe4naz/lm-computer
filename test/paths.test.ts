import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PathGuard, PathOutsideWorkspaceError } from "../src/core/paths";

let root: string;
let outside: string;
let guard: PathGuard;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lmc-paths-"));
  outside = await mkdtemp(path.join(os.tmpdir(), "lmc-outside-"));
  await mkdir(path.join(root, "sub"));
  await writeFile(path.join(root, "a.txt"), "hello");
  await writeFile(path.join(outside, "secret.txt"), "secret");
  guard = await PathGuard.create(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("PathGuard", () => {
  it("resolves paths inside the workspace", async () => {
    await expect(guard.resolve("a.txt")).resolves.toBe(path.join(root, "a.txt"));
    await expect(guard.resolve("sub/new.txt")).resolves.toBe(
      path.join(root, "sub", "new.txt"),
    );
    await expect(guard.resolve("")).resolves.toBe(root);
  });

  it("allows absolute paths inside the workspace", async () => {
    await expect(guard.resolve(path.join(root, "a.txt"))).resolves.toBe(
      path.join(root, "a.txt"),
    );
  });

  it("rejects parent traversal", async () => {
    await expect(guard.resolve("../escape.txt")).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
    await expect(guard.resolve("sub/../../escape.txt")).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
  });

  it("rejects absolute paths outside the workspace", async () => {
    await expect(guard.resolve(path.join(outside, "secret.txt"))).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
  });

  it("rejects a symlink or junction that escapes the workspace", async () => {
    const link = path.join(root, "escape-link");
    try {
      await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // Windows without junction support.
    }
    await expect(guard.resolve("escape-link/secret.txt")).rejects.toBeInstanceOf(
      PathOutsideWorkspaceError,
    );
  });
});
