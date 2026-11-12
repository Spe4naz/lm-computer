import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type AuditDecision = "allowed" | "denied" | "auto" | "not-required";

export interface AuditEntry {
  id: string;
  ts: number;
  tool: string;
  origin: string;
  args: unknown;
  decision: AuditDecision;
  ok: boolean;
  ms: number;
  error?: string;
}

const SECRET_KEYS = /token|password|secret|authorization|api[-_]?key/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") {
    return value.length > 400 ? `${value.slice(0, 400)}… (${value.length} chars)` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? "***" : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  constructor(
    private readonly file: string,
    private readonly maxEntries = 1000,
  ) {}

  async append(entry: Omit<AuditEntry, "id" | "ts" | "args"> & { args: unknown }): Promise<AuditEntry> {
    const full: AuditEntry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      ...entry,
      args: redact(entry.args),
    };
    this.entries.push(full);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, `${JSON.stringify(full)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch {
      // An audit write failure must not break a tool call. The in-memory tail
      // is still available through the API.
    }
    return full;
  }

  tail(limit = 100): AuditEntry[] {
    const safe = Math.max(1, Math.min(1000, Math.trunc(limit)));
    return this.entries.slice(-safe).reverse();
  }
}
