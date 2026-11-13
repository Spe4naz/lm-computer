import { spawn } from "node:child_process";

export class DangerousCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DangerousCommandError";
  }
}

const DENY_RULES: Array<{ pattern: RegExp; label: string }> = [
  {
    // Match the commands anywhere in the line: `env sudo`, `/usr/bin/sudo`
    // and `bash -c 'sudo …'` bypassed the old anchor-based rule. This remains
    // a speed bump, not a sandbox: encoded or scripted commands can still hide.
    pattern: /\b(sudo|doas|pkexec|su)\b/i,
    label: "privilege escalation",
  },
  { pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, label: "filesystem formatting" },
  { pattern: /\bwipefs\b/i, label: "filesystem wiping" },
  { pattern: /\b(fdisk|parted|sgdisk|gdisk)\b/i, label: "partition editing" },
  {
    pattern: /\bdd\b[^\n]*\bof=\/dev\//i,
    label: "raw device write",
  },
  {
    pattern: /\b(shutdown|reboot|poweroff|halt)\b/i,
    label: "power management",
  },
  {
    pattern: /\bchmod\s+-R\s+777\s+\/(\s|$)/i,
    label: "permission change on /",
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    label: "fork bomb",
  },
  {
    pattern: /\brm\s+-[a-z]*[rf][a-z]*\s+(\/|~|\$HOME)(\s|$)/i,
    label: "recursive delete of a root directory",
  },
];

export function assertSafeCommand(command: string): void {
  const trimmed = command.trim();
  if (trimmed.length === 0) throw new DangerousCommandError("Empty command");
  if (trimmed.length > 8000) throw new DangerousCommandError("Command is too long");
  for (const rule of DENY_RULES) {
    if (rule.pattern.test(trimmed)) {
      throw new DangerousCommandError(
        `Blocked command (${rule.label}). Ask the user to run it manually if it is really needed.`,
      );
    }
  }
}

export interface ShellOptions {
  command: string;
  cwd: string;
  timeoutSec: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

/**
 * Environment handed to a shell command. LM Studio and the standalone service
 * inherit internal variables (`LMS_PLUGIN_CLIENT_PASSKEY`, proxy credentials,
 * SSH agent sockets) that must never become visible to the model through
 * `env` or `printenv`.
 */
const SAFE_ENV_KEYS = new Set([
  "path",
  "home",
  "user",
  "username",
  "logname",
  "shell",
  "lang",
  "language",
  "lc_all",
  "lc_ctype",
  "lc_messages",
  "lc_numeric",
  "lc_time",
  "term",
  "tmpdir",
  "tmp",
  "temp",
  "tz",
  "display",
  "wayland_display",
  "xdg_runtime_dir",
  "xdg_config_home",
  "xdg_data_home",
  "xdg_cache_home",
  "xdg_data_dirs",
  "systemroot",
  "windir",
  "systemdrive",
  "comspec",
  "pathext",
  "userprofile",
  "appdata",
  "localappdata",
  "programdata",
  "programfiles",
  "programfiles(x86)",
  "number_of_processors",
  "processor_architecture",
  "os",
  "driverdata",
]);

export function buildShellEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (!SAFE_ENV_KEYS.has(key.toLowerCase())) continue;
    env[key] = value;
  }
  return env;
}

export interface ShellResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string;
  truncated: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
}

export async function runShell(options: ShellOptions): Promise<ShellResult> {
  assertSafeCommand(options.command);
  const started = Date.now();
  const isWindows = process.platform === "win32";
  const shell = isWindows ? process.env.ComSpec ?? "cmd.exe" : "/bin/bash";
  const args = isWindows ? ["/d", "/s", "/c", options.command] : ["-c", options.command];

  return new Promise<ShellResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let stored = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(shell, args, {
      cwd: options.cwd,
      env: buildShellEnv(),
      detached: !isWindows && process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (stored >= options.maxOutputBytes) {
        truncated = true;
        return;
      }
      const remaining = options.maxOutputBytes - stored;
      const slice = chunk.subarray(0, remaining);
      stored += slice.length;
      if (slice.length < chunk.length) truncated = true;
      if (target === "stdout") stdout += slice.toString("utf8");
      else stderr += slice.toString("utf8");
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const killTree = (): void => {
      if (child.pid == null) return;
      if (isWindows) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // The process already exited.
          }
        }
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killTree();
    }, options.timeoutSec * 1000);

    const onAbort = (): void => {
      cancelled = true;
      killTree();
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const finish = (exitCode: number | null, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      const errorText = error ? `${error.name}: ${error.message}` : "";
      const stderrText = [stderr, errorText].filter(Boolean).join("\n");
      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderrText) parts.push(`[stderr]\n${stderrText}`);
      if (truncated) parts.push("\n[output truncated]");
      if (timedOut) parts.push("\n[command timed out]");
      if (cancelled) parts.push("\n[command cancelled]");
      resolve({
        command: options.command,
        cwd: options.cwd,
        exitCode,
        stdout,
        stderr: stderrText,
        output: parts.join("\n").trim(),
        truncated,
        timedOut,
        cancelled,
        durationMs: Date.now() - started,
      });
    };

    child.once("error", (error) => finish(null, error));
    child.once("close", (code) => finish(code));
  });
}
