import os from "node:os";
import { z } from "zod";
import type { ComputerConfig } from "../config";
import type { FileTools } from "./files";
import type { ShellResult } from "./shell";
import type { ToolCallContext, ToolResult, ToolSpec } from "./types";

export interface ToolRuntime {
  readonly config: ComputerConfig;
  readonly homeDir: string;
  readonly files: FileTools;
  autoAcceptRemainingSec(): number;
  runShell(input: {
    command: string;
    cwd: string;
    timeoutSec: number;
    signal?: AbortSignal;
  }): Promise<ShellResult>;
  openPath(absolutePath: string): Promise<void>;
}

const modeSchema = z.enum(["create", "overwrite", "append"]);

export function createToolSpecs(runtime: ToolRuntime): ToolSpec[] {
  const specs: ToolSpec[] = [];

  specs.push({
    name: "computer_status",
    description:
      "Show the computer workspace, whether shell commands are enabled, the approval mode and the remaining auto-accept time. Useful before starting a task.",
    parameters: {},
    risk: "low",
    approval: "never",
    handler: async (): Promise<ToolResult> => {
      const autoSec = runtime.autoAcceptRemainingSec();
      return {
        text: [
          `Workspace: ${runtime.files.root}`,
          `Shell: ${runtime.config.shellEnabled ? "enabled" : "disabled"}`,
          `Approval: ${autoSec > 0 ? `temporary auto-accept for ${autoSec}s` : "ask in LM Chat"}`,
          `Platform: ${process.platform} ${process.arch}`,
          "File tools are restricted to the workspace. Commands run on the host after approval.",
        ].join("\n"),
      };
    },
  });

  specs.push({
    name: "fs_list",
    description:
      "List files and folders inside the workspace. Paths are relative to the workspace root.",
    parameters: { path: z.string().optional().describe("Relative folder path; default is the workspace root") },
    risk: "low",
    approval: "never",
    handler: async (args): Promise<ToolResult> => {
      const entries = await runtime.files.list(args.path as string | undefined);
      if (entries.length === 0) return { text: "Directory is empty.", data: [] };
      const lines = entries.map((entry) => {
        const suffix = entry.type === "dir" ? "/" : "";
        const size = entry.type === "file" ? ` · ${formatBytes(entry.size)}` : "";
        const link = entry.symlink ? " → symlink" : "";
        return `${entry.type === "dir" ? "dir " : "file"} ${entry.path}${suffix}${size}${link}`;
      });
      return { text: lines.join("\n"), data: entries };
    },
  });

  specs.push({
    name: "fs_read",
    description:
      "Read a UTF-8 text file inside the workspace. Refuses binary files and files larger than max_bytes.",
    parameters: {
      path: z.string().describe("Relative file path"),
      max_bytes: z.number().int().min(1).max(1024 * 1024).optional(),
    },
    risk: "low",
    approval: "never",
    handler: async (args): Promise<ToolResult> => {
      const result = await runtime.files.read(
        args.path as string,
        args.max_bytes as number | undefined,
      );
      return {
        text: `File: ${result.path} (${formatBytes(result.size)})\n\n${result.content}`,
        data: result,
      };
    },
  });

  specs.push({
    name: "fs_write",
    description:
      "Write a UTF-8 text file inside the workspace. Modes: create (fail if exists), overwrite (default), append. Parent folders are created automatically.",
    parameters: {
      path: z.string().describe("Relative file path"),
      content: z.string().describe("Full text to write"),
      mode: modeSchema.optional(),
    },
    risk: "medium",
    approval: "never",
    handler: async (args): Promise<ToolResult> => {
      const result = await runtime.files.write(
        args.path as string,
        args.content as string,
        (args.mode as "create" | "overwrite" | "append" | undefined) ?? "overwrite",
      );
      return {
        text: `${result.created ? "Created" : "Updated"} ${result.path} (${formatBytes(result.bytes)}).`,
        data: result,
      };
    },
  });

  specs.push({
    name: "fs_append",
    description: "Append UTF-8 text to a file inside the workspace, creating it if needed.",
    parameters: {
      path: z.string().describe("Relative file path"),
      content: z.string().describe("Text to append"),
    },
    risk: "medium",
    approval: "never",
    handler: async (args): Promise<ToolResult> => {
      const result = await runtime.files.write(args.path as string, args.content as string, "append");
      return {
        text: `Appended to ${result.path} (${formatBytes(result.bytes)}).`,
        data: result,
      };
    },
  });

  specs.push({
    name: "fs_mkdir",
    description: "Create a folder inside the workspace, including missing parents.",
    parameters: { path: z.string().describe("Relative folder path") },
    risk: "low",
    approval: "never",
    handler: async (args): Promise<ToolResult> => {
      const result = await runtime.files.mkdir(args.path as string);
      return { text: `Created folder ${result.path}.`, data: result };
    },
  });

  specs.push({
    name: "fs_move",
    description:
      "Move or rename a file or folder inside the workspace. Set overwrite=true to replace an existing destination.",
    parameters: {
      from: z.string().describe("Relative source path"),
      to: z.string().describe("Relative destination path"),
      overwrite: z.boolean().optional(),
    },
    risk: "medium",
    approval: "always",
    approvalDetails: (args) => ({
      summary: `Move ${String(args.from)} → ${String(args.to)}`,
      details: { from: args.from, to: args.to, overwrite: args.overwrite === true },
    }),
    handler: async (args): Promise<ToolResult> => {
      const result = await runtime.files.move(
        args.from as string,
        args.to as string,
        args.overwrite === true,
      );
      return { text: `Moved ${result.from} → ${result.to}.`, data: result };
    },
  });

  specs.push({
    name: "fs_delete",
    description:
      "Move a file or folder inside the workspace to the trash. Nothing is deleted permanently.",
    parameters: { path: z.string().describe("Relative path to remove") },
    risk: "high",
    approval: "always",
    approvalDetails: (args) => ({
      summary: `Move to trash: ${String(args.path)}`,
      details: { path: args.path },
    }),
    handler: async (args): Promise<ToolResult> => {
      const result = await runtime.files.deleteToTrash(args.path as string, runtime.homeDir);
      return { text: `Moved ${result.from} to trash: ${result.trash}.`, data: result };
    },
  });

  specs.push({
    name: "fs_search",
    description:
      "Search file names and text content inside the workspace. Returns relative paths and matching lines. Use a glob such as **/*.md to narrow the search.",
    parameters: {
      query: z.string().describe("Case-insensitive text to find; empty string searches names only"),
      glob: z.string().optional().describe("Optional glob relative to the workspace, e.g. **/*.md"),
      max_results: z.number().int().min(1).max(200).optional(),
    },
    risk: "low",
    approval: "never",
    handler: async (args): Promise<ToolResult> => {
      const results = await runtime.files.search(
        (args.query as string | undefined) ?? "",
        args.glob as string | undefined,
        (args.max_results as number | undefined) ?? 50,
      );
      if (results.length === 0) return { text: "No matches.", data: [] };
      const lines = results.map((entry) => {
        if (!entry.matches) return `- ${entry.path}`;
        const matches = entry.matches
          .map((match) => `    ${match.line}: ${match.text}`)
          .join("\n");
        return `- ${entry.path}\n${matches}`;
      });
      return { text: lines.join("\n"), data: results };
    },
  });

  specs.push({
    name: "system_info",
    description: "Show operating system, CPU, memory, uptime and workspace information.",
    parameters: {},
    risk: "low",
    approval: "never",
    handler: async (): Promise<ToolResult> => {
      const info = {
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        release: os.release(),
        cpu: os.cpus()[0]?.model ?? "unknown",
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        freeMemoryBytes: os.freemem(),
        uptimeSeconds: Math.round(os.uptime()),
        workspace: runtime.files.root,
        shellEnabled: runtime.config.shellEnabled,
      };
      return { text: JSON.stringify(info, null, 2), data: info };
    },
  });

  specs.push({
    name: "open_path",
    description:
      "Open a file or folder from the workspace in the desktop file manager or its default application.",
    parameters: { path: z.string().describe("Relative path to open") },
    risk: "medium",
    approval: "always",
    approvalDetails: (args) => ({
      summary: `Open on the computer: ${String(args.path)}`,
      details: { path: args.path },
    }),
    handler: async (args, ctx): Promise<ToolResult> => {
      const absolute = await runtime.files.resolve(args.path as string);
      ctx.status?.("Открываю на компьютере…");
      await runtime.openPath(absolute);
      return { text: `Opened ${runtime.files.root === absolute ? "workspace" : String(args.path)}.` };
    },
  });

  specs.push({
    name: "shell_run",
    description:
      "Run a shell command on the host computer. The user must approve it in LM Chat unless temporary auto-accept is active. Prefer file tools for reading and writing. Never use sudo or destructive system commands.",
    parameters: {
      command: z.string().describe("Command line to execute"),
      cwd: z.string().optional().describe("Working directory relative to the workspace; default is the workspace"),
      timeout_sec: z.number().int().min(1).max(600).optional(),
    },
    risk: "high",
    approval: "always",
    approvalDetails: (args) => ({
      summary: `Run command: ${String(args.command)}`,
      details: { command: args.command, cwd: args.cwd ?? ".", timeout_sec: args.timeout_sec },
    }),
    handler: async (args, ctx): Promise<ToolResult> => {
      if (!runtime.config.shellEnabled) {
        return { text: "Shell commands are disabled in the plugin settings." };
      }
      const cwd = await runtime.files.resolve((args.cwd as string | undefined) ?? ".");
      const timeout = Math.min(
        runtime.config.shellTimeoutSec,
        (args.timeout_sec as number | undefined) ?? runtime.config.shellTimeoutSec,
      );
      ctx.status?.("Выполняю команду на компьютере…");
      const result = await runtime.runShell({
        command: args.command as string,
        cwd,
        timeoutSec: timeout,
        signal: ctx.signal,
      });
      const header = result.timedOut
        ? "Command timed out."
        : result.cancelled
          ? "Command cancelled."
          : `Exit code: ${result.exitCode ?? "unknown"} (${result.durationMs} ms)`;
      return {
        text: `${header}\n\n${result.output || "(no output)"}`,
        data: result,
      };
    },
  });

  return specs;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
