import { spawn } from "node:child_process";
import { z } from "zod";
import {
  auditPath,
  defaultHomeDir,
  loadConfig,
  publicConfig,
  saveConfig,
  type ComputerConfig,
  type PublicConfig,
} from "../config";
import { AuditLog, type AuditDecision } from "./audit";
import { ApprovalManager, type ApprovalOutcome } from "./approvals";
import { EventBus } from "./events";
import { FileTools } from "./files";
import { PathGuard } from "./paths";
import { runShell as executeShell, type ShellResult } from "./shell";
import { createToolSpecs, type ToolRuntime } from "./tools";
import type { ToolCallContext, ToolResult, ToolSpec } from "./types";
import { PLUGIN_NAME, VERSION } from "../version";

export interface ServiceOptions {
  homeDir?: string;
  config?: Partial<ComputerConfig>;
}

export interface ServiceStatus {
  ok: boolean;
  name: string;
  version: string;
  pid: number;
  platform: string;
  startedAt: number;
  workspace: string;
  host: string;
  port: number;
  shellEnabled: boolean;
  approvalTimeoutSec: number;
  pendingApprovals: number;
  autoAcceptUntil: number;
  autoAcceptRemainingSec: number;
  activeCommands: number;
  tokenFile: string;
  configFile: string;
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/**
 * Owns the workspace, approvals, audit log, HTTP API and tool registry. The
 * same instance is used by the LM Studio tools provider, the MCP endpoint and
 * the REST API.
 */
export class ComputerService implements ToolRuntime {
  readonly homeDir: string;
  private _config: ComputerConfig;
  private _guard: PathGuard;
  private _files: FileTools;
  readonly events: EventBus;
  readonly audit: AuditLog;
  readonly approvals: ApprovalManager;
  readonly specs: ToolSpec[];
  readonly startedAt = Date.now();

  private readonly toolMap: Map<string, ToolSpec>;
  private readonly activeShells = new Set<AbortController>();
  private lastAppSeen = 0;
  private http: import("./http").HttpApi | undefined;

  private constructor(homeDir: string, config: ComputerConfig, guard: PathGuard) {
    this.homeDir = homeDir;
    this._config = config;
    this._guard = guard;
    this._files = new FileTools(guard);
    this.events = new EventBus();
    this.audit = new AuditLog(auditPath(homeDir));
    this.approvals = new ApprovalManager({
      timeoutSec: config.approvalTimeoutSec,
      zenityFallback: config.zenityFallback,
      events: this.events,
      isAppActive: () => this.isAppActive(),
    });
    this.specs = createToolSpecs(this);
    this.toolMap = new Map(this.specs.map((spec) => [spec.name, spec]));
  }

  static async create(options: ServiceOptions = {}): Promise<ComputerService> {
    const homeDir = options.homeDir ?? defaultHomeDir();
    const config = await loadConfig(homeDir, options.config);
    const guard = await PathGuard.create(config.workspace);
    return new ComputerService(homeDir, config, guard);
  }

  get config(): ComputerConfig {
    return this._config;
  }

  get files(): FileTools {
    return this._files;
  }

  get guard(): PathGuard {
    return this._guard;
  }

  get toolSpecs(): readonly ToolSpec[] {
    return this.specs;
  }

  publicConfig(): PublicConfig {
    return publicConfig(this.homeDir, this._config);
  }

  status(): ServiceStatus {
    const remaining = Math.max(
      0,
      Math.ceil((this.approvals.autoAcceptDeadline - Date.now()) / 1000),
    );
    return {
      ok: true,
      name: PLUGIN_NAME,
      version: VERSION,
      pid: process.pid,
      platform: `${process.platform} ${process.arch}`,
      startedAt: this.startedAt,
      workspace: this._files.root,
      host: this._config.host,
      port: this._config.port,
      shellEnabled: this._config.shellEnabled,
      approvalTimeoutSec: this._config.approvalTimeoutSec,
      pendingApprovals: this.approvals.list().length,
      autoAcceptUntil: this.approvals.autoAcceptDeadline,
      autoAcceptRemainingSec: remaining,
      activeCommands: this.activeShells.size,
      tokenFile: this.publicConfig().tokenFile,
      configFile: this.publicConfig().configFile,
    };
  }

  autoAcceptRemainingSec(): number {
    return Math.max(0, Math.ceil((this.approvals.autoAcceptDeadline - Date.now()) / 1000));
  }

  markAppSeen(): void {
    this.lastAppSeen = Date.now();
  }

  isAppActive(): boolean {
    return Date.now() - this.lastAppSeen < 15_000;
  }

  setAutoAccept(seconds: number): number {
    return this.approvals.setAutoAccept(seconds, this._config.autoAcceptMaxSec);
  }

  cancelAll(): void {
    this.approvals.cancelAll();
    for (const controller of [...this.activeShells]) controller.abort();
    this.events.add("cancel_all", {});
  }

  async startHttp(): Promise<{ host: string; port: number }> {
    if (this.http) return { host: this._config.host, port: this._config.port };
    const { HttpApi } = await import("./http");
    const api = new HttpApi(this);
    await api.start();
    this.http = api;
    return { host: this._config.host, port: this._config.port };
  }

  async stopHttp(): Promise<void> {
    await this.http?.stop();
    this.http = undefined;
  }

  async updateConfig(patch: Partial<ComputerConfig>): Promise<PublicConfig> {
    const next: ComputerConfig = { ...this._config };
    if (patch.workspace !== undefined) {
      const guard = await PathGuard.create(patch.workspace);
      this._guard = guard;
      this._files = new FileTools(guard);
      next.workspace = guard.root;
    }
    if (patch.shellEnabled !== undefined) next.shellEnabled = patch.shellEnabled;
    if (patch.approvalTimeoutSec !== undefined) {
      next.approvalTimeoutSec = clamp(patch.approvalTimeoutSec, 5, 3600);
      this.approvals.configure({ timeoutSec: next.approvalTimeoutSec });
    }
    if (patch.shellTimeoutSec !== undefined) {
      next.shellTimeoutSec = clamp(patch.shellTimeoutSec, 1, 3600);
    }
    if (patch.maxOutputBytes !== undefined) {
      next.maxOutputBytes = clamp(patch.maxOutputBytes, 1024, 4 * 1024 * 1024);
    }
    if (patch.zenityFallback !== undefined) {
      next.zenityFallback = patch.zenityFallback;
      this.approvals.configure({ zenityFallback: next.zenityFallback });
    }
    if (patch.autoAcceptMaxSec !== undefined) {
      next.autoAcceptMaxSec = clamp(patch.autoAcceptMaxSec, 0, 30 * 60);
    }
    this._config = next;
    await saveConfig(this.homeDir, next);
    this.events.add("config_changed", {
      workspace: next.workspace,
      shellEnabled: next.shellEnabled,
    });
    return this.publicConfig();
  }

  async runShell(input: {
    command: string;
    cwd: string;
    timeoutSec: number;
    signal?: AbortSignal;
  }): Promise<ShellResult> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    if (input.signal) {
      if (input.signal.aborted) controller.abort();
      else input.signal.addEventListener("abort", abort, { once: true });
    }
    this.activeShells.add(controller);
    try {
      return await executeShell({
        command: input.command,
        cwd: input.cwd,
        timeoutSec: input.timeoutSec,
        maxOutputBytes: this._config.maxOutputBytes,
        signal: controller.signal,
      });
    } finally {
      this.activeShells.delete(controller);
      if (input.signal) input.signal.removeEventListener("abort", abort);
    }
  }

  async openPath(absolutePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let command: string;
      let args: string[];
      if (process.platform === "win32") {
        command = "explorer.exe";
        args = [absolutePath];
      } else if (process.platform === "darwin") {
        command = "open";
        args = [absolutePath];
      } else {
        command = "xdg-open";
        args = [absolutePath];
      }
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }

  async executeTool(
    name: string,
    rawArgs: unknown,
    ctx: ToolCallContext,
  ): Promise<ToolResult> {
    const spec = this.toolMap.get(name);
    if (!spec) throw new ToolInputError(`Unknown tool: ${name}`);

    const parsed = parseArgs(spec, rawArgs);
    const started = Date.now();
    this.events.add("tool_started", {
      tool: spec.name,
      origin: ctx.origin,
      risk: spec.risk,
    });

    let decision: AuditDecision = "not-required";
    if (spec.approval === "always") {
      const approval = spec.approvalDetails?.(parsed) ?? {
        summary: spec.name,
        details: parsed,
      };
      ctx.status?.("Ожидает подтверждения в LM Chat…");
      const outcome: ApprovalOutcome = await this.approvals.request({
        tool: spec.name,
        risk: spec.risk,
        summary: approval.summary,
        details: approval.details,
        origin: ctx.origin,
        signal: ctx.signal,
      });
      if (outcome.decision !== "allow") {
        const ms = Date.now() - started;
        const reason =
          outcome.decision === "timeout"
            ? "Подтверждение не получено, действие отклонено."
            : outcome.decision === "cancelled"
              ? "Действие отменено."
              : "Пользователь отклонил действие.";
        await this.audit.append({
          tool: spec.name,
          origin: ctx.origin,
          args: parsed,
          decision: "denied",
          ok: false,
          ms,
          error: reason,
        });
        this.events.add("tool_finished", {
          tool: spec.name,
          origin: ctx.origin,
          ok: false,
          ms,
          decision: outcome.decision,
        });
        return { text: `Denied: ${reason}` };
      }
      decision = outcome.via === "auto" ? "auto" : "allowed";
      ctx.status?.("Подтверждено, выполняю…");
    }

    try {
      const result = await spec.handler(parsed, ctx);
      const ms = Date.now() - started;
      await this.audit.append({
        tool: spec.name,
        origin: ctx.origin,
        args: parsed,
        decision,
        ok: true,
        ms,
      });
      this.events.add("tool_finished", {
        tool: spec.name,
        origin: ctx.origin,
        ok: true,
        ms,
        decision,
        result: summarizeResult(result),
      });
      this.emitFileEvent(spec.name, result);
      return result;
    } catch (error) {
      const ms = Date.now() - started;
      const message = errorMessage(error);
      await this.audit.append({
        tool: spec.name,
        origin: ctx.origin,
        args: parsed,
        decision,
        ok: false,
        ms,
        error: message,
      });
      this.events.add("tool_finished", {
        tool: spec.name,
        origin: ctx.origin,
        ok: false,
        ms,
        decision,
        error: message,
      });
      throw error;
    }
  }

  private emitFileEvent(tool: string, result: ToolResult): void {
    if (
      tool !== "fs_write" &&
      tool !== "fs_append" &&
      tool !== "fs_move" &&
      tool !== "fs_delete"
    ) {
      return;
    }
    const data = result.data as Record<string, unknown> | undefined;
    if (!data) return;
    this.events.add("file_changed", {
      tool,
      path: data.path ?? data.from ?? "",
      to: data.to ?? data.trash ?? "",
    });
  }
}

function parseArgs(spec: ToolSpec, raw: unknown): Record<string, unknown> {
  try {
    return z.object(spec.parameters).passthrough().parse(raw ?? {}) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const text = error.issues
        .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
        .join("; ");
      throw new ToolInputError(`Invalid arguments: ${text}`);
    }
    throw error;
  }
}

function summarizeResult(result: ToolResult): Record<string, unknown> | undefined {
  const data = result.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of [
    "path",
    "from",
    "to",
    "trash",
    "bytes",
    "created",
    "exitCode",
    "timedOut",
    "truncated",
    "cancelled",
    "durationMs",
  ]) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
