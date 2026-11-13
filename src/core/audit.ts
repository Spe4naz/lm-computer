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

const SECRET_KEYS = /token|password|passwd|secret|authorization|api[-_]?key|passkey/i;
const MAX_AUDIT_BYTES = 5 * 1024 * 1024;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1***"],
  [
    /((?:password|passwd|pwd|token|secret|api[-_]?key|authorization)\s*[:=]\s*)(?!bearer\b)("[^"]*"|'[^']*'|\S+)/gi,
    "$1***",
  ],
  [/(--?(?:password|passwd|token|secret|api[-_]?key)\s+)(\S+)/gi, "$1***"],
  [
    /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    "***",
  ],
  [/\/\/[^/\s:@]+:[^/\s@]+@/g, "//***:***@"],
];

/**
 * Commands and free-form arguments can contain credentials. The old audit log
 * only masked object keys, so `curl -H "Authorization: Bearer …"` or
 * `--password secret` was written verbatim.
 */
function redactString(value: string): string {
  let text = value.length > 400 ? `${value.slice(0, 400)}… (${value.length} chars)` : value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return redactString(value);
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
  private bytesWritten = 0;

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
    const line = `${JSON.stringify(full)}\n`;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, line, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.bytesWritten += Buffer.byteLength(line);
      if (this.bytesWritten >= MAX_AUDIT_BYTES) {
        await this.rotate();
      }
    } catch {
      // An audit write failure must not break a tool call. The in-memory tail
      // is still available through the API.
    }
    return full;
  }

  private async rotate(): Promise<void> {
    try {
      await fs.rename(this.file, `${this.file}.1`);
    } catch {
      // Another process may hold the file; keep appending instead of losing it.
    }
    this.bytesWritten = 0;
  }

  tail(limit = 100): AuditEntry[] {
    const safe = Math.max(1, Math.min(1000, Math.trunc(limit)));
    return this.entries.slice(-safe).reverse();
  }
}
