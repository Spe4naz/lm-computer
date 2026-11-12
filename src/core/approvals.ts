import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import type { EventBus } from "./events";
import type { ToolOrigin, ToolRisk } from "./types";

export interface ApprovalRequest {
  id: string;
  tool: string;
  risk: ToolRisk;
  summary: string;
  details: Record<string, unknown>;
  origin: ToolOrigin;
  createdAt: number;
  expiresAt: number;
}

export type ApprovalDecision = "allow" | "deny" | "timeout" | "cancelled";

export interface ApprovalOutcome {
  decision: ApprovalDecision;
  via: "auto" | "app" | "zenity" | "timeout" | "abort";
}

interface PendingApproval {
  request: ApprovalRequest;
  timer: NodeJS.Timeout;
  zenity?: ChildProcess;
  zenityTimer?: NodeJS.Timeout;
  abortListener?: () => void;
  settle: (outcome: ApprovalOutcome) => void;
}

export interface ApprovalManagerOptions {
  timeoutSec: number;
  zenityFallback: boolean;
  events: EventBus;
  isAppActive: () => boolean;
  zenityDelayMs?: number;
}

/**
 * Holds tool calls until the user confirms them in the LM Chat app. When the
 * app has not talked to the plugin recently, a zenity dialog on the LM Studio
 * machine is used as a fallback.
 */
export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();
  private autoAcceptUntil = 0;

  constructor(private readonly options: ApprovalManagerOptions) {}

  get autoAcceptDeadline(): number {
    return this.autoAcceptUntil > Date.now() ? this.autoAcceptUntil : 0;
  }

  configure(patch: { timeoutSec?: number; zenityFallback?: boolean }): void {
    if (patch.timeoutSec !== undefined) {
      this.options.timeoutSec = Math.max(5, Math.min(3600, Math.trunc(patch.timeoutSec)));
    }
    if (patch.zenityFallback !== undefined) {
      this.options.zenityFallback = patch.zenityFallback;
    }
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((item) => item.request);
  }

  setAutoAccept(seconds: number, maxSeconds: number): number {
    const safe = Math.max(0, Math.min(maxSeconds, Math.trunc(seconds)));
    this.autoAcceptUntil = safe > 0 ? Date.now() + safe * 1000 : 0;
    this.options.events.add("auto_accept", {
      seconds: safe,
      until: this.autoAcceptUntil,
    });
    return this.autoAcceptUntil;
  }

  resolve(id: string, allow: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.finish(entry, { decision: allow ? "allow" : "deny", via: "app" });
    return true;
  }

  cancelAll(): void {
    for (const entry of [...this.pending.values()]) {
      this.finish(entry, { decision: "cancelled", via: "abort" });
    }
  }

  async request(input: {
    tool: string;
    risk: ToolRisk;
    summary: string;
    details: Record<string, unknown>;
    origin: ToolOrigin;
    signal?: AbortSignal;
  }): Promise<ApprovalOutcome> {
    if (this.autoAcceptUntil > Date.now() && this.options.isAppActive()) {
      this.options.events.add("approval_auto", {
        tool: input.tool,
        origin: input.origin,
      });
      return { decision: "allow", via: "auto" };
    }

    const now = Date.now();
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      tool: input.tool,
      risk: input.risk,
      summary: input.summary,
      details: input.details,
      origin: input.origin,
      createdAt: now,
      expiresAt: now + this.options.timeoutSec * 1000,
    };

    this.options.events.add("approval_requested", {
      id: request.id,
      tool: request.tool,
      origin: request.origin,
      risk: request.risk,
      summary: request.summary,
    });

    return new Promise<ApprovalOutcome>((resolve) => {
      const entry: PendingApproval = {
        request,
        timer: setTimeout(() => {
          this.finish(entry, { decision: "timeout", via: "timeout" });
        }, this.options.timeoutSec * 1000),
        settle: resolve,
      };

      if (input.signal) {
        if (input.signal.aborted) {
          clearTimeout(entry.timer);
          resolve({ decision: "cancelled", via: "abort" });
          return;
        }
        entry.abortListener = () => {
          this.finish(entry, { decision: "cancelled", via: "abort" });
        };
        input.signal.addEventListener("abort", entry.abortListener, { once: true });
      }

      this.pending.set(request.id, entry);

      if (this.options.zenityFallback && !this.options.isAppActive()) {
        entry.zenityTimer = setTimeout(() => {
          if (this.pending.has(request.id)) this.showZenity(entry);
        }, this.options.zenityDelayMs ?? 1000);
      }
    });
  }

  private finish(entry: PendingApproval, outcome: ApprovalOutcome): void {
    const id = entry.request.id;
    if (!this.pending.has(id)) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (entry.zenityTimer) clearTimeout(entry.zenityTimer);
    if (entry.zenity && !entry.zenity.killed) {
      try {
        entry.zenity.kill();
      } catch {
        // The dialog already exited.
      }
    }
    entry.settle(outcome);
    this.options.events.add("approval_resolved", {
      id,
      tool: entry.request.tool,
      decision: outcome.decision,
      via: outcome.via,
    });
  }

  private showZenity(entry: PendingApproval): void {
    const request = entry.request;
    const text = [
      `LM Computer: ${request.tool}`,
      "",
      request.summary,
      "",
      "Подтвердите действие в LM Chat или нажмите кнопку ниже.",
    ].join("\n");
    let child: ChildProcess;
    try {
      child = spawn(
        "zenity",
        [
          "--question",
          "--title=LM Computer",
          "--ok-label=Разрешить",
          "--cancel-label=Запретить",
          `--text=${text.slice(0, 3000)}`,
        ],
        { stdio: "ignore" },
      );
    } catch {
      this.options.events.add("zenity_unavailable", { id: request.id });
      return;
    }
    entry.zenity = child;
    child.once("error", () => {
      this.options.events.add("zenity_unavailable", { id: request.id });
    });
    child.once("close", (code) => {
      if (!this.pending.has(request.id)) return;
      this.finish(entry, {
        decision: code === 0 ? "allow" : "deny",
        via: "zenity",
      });
    });
  }
}
