import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface ComputerConfig {
  /** Workspace the file tools are allowed to touch. */
  workspace: string;
  /** HTTP bind address. 0.0.0.0 makes the approval console reachable on the LAN. */
  host: string;
  port: number;
  /** Bearer token for the REST and MCP endpoints. */
  token: string;
  shellEnabled: boolean;
  approvalTimeoutSec: number;
  shellTimeoutSec: number;
  maxOutputBytes: number;
  /** Upper bound for a temporary auto-accept window requested from the app. */
  autoAcceptMaxSec: number;
  /** Show a zenity dialog when the app is not connected. */
  zenityFallback: boolean;
}

export const HARD_AUTO_ACCEPT_MAX_SEC = 30 * 60;

export const DEFAULT_CONFIG: ComputerConfig = {
  workspace: "~/lm-chat-computer",
  host: "0.0.0.0",
  port: 1236,
  token: "",
  shellEnabled: true,
  approvalTimeoutSec: 120,
  shellTimeoutSec: 120,
  maxOutputBytes: 64 * 1024,
  autoAcceptMaxSec: HARD_AUTO_ACCEPT_MAX_SEC,
  zenityFallback: true,
};

export function defaultHomeDir(): string {
  const override = process.env.LM_COMPUTER_HOME?.trim();
  if (override) return path.resolve(expandHome(override));
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) return path.join(appData, "lm-computer");
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "lm-computer");
  return path.join(os.homedir(), ".config", "lm-computer");
}

export function expandHome(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

export function configPath(homeDir: string): string {
  return path.join(homeDir, "config.json");
}

export function tokenPath(homeDir: string): string {
  return path.join(homeDir, "token.txt");
}

export function auditPath(homeDir: string): string {
  return path.join(homeDir, "audit.jsonl");
}

export function trashDir(homeDir: string): string {
  return path.join(homeDir, "trash");
}

export async function ensureHome(homeDir: string): Promise<void> {
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(trashDir(homeDir), { recursive: true });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeConfig(
  input: Partial<ComputerConfig> | Record<string, unknown>,
  base: ComputerConfig,
): ComputerConfig {
  const raw = input as Partial<ComputerConfig>;
  const workspace =
    typeof raw.workspace === "string" && raw.workspace.trim().length > 0
      ? path.resolve(expandHome(raw.workspace))
      : base.workspace;
  const host =
    typeof raw.host === "string" && raw.host.trim().length > 0
      ? raw.host.trim()
      : base.host;
  const token =
    typeof raw.token === "string" && raw.token.trim().length > 0
      ? raw.token.trim()
      : base.token;
  return {
    workspace,
    host,
    port: clampInt(raw.port, 1, 65535, base.port),
    token,
    shellEnabled:
      typeof raw.shellEnabled === "boolean" ? raw.shellEnabled : base.shellEnabled,
    approvalTimeoutSec: clampInt(
      raw.approvalTimeoutSec,
      5,
      3600,
      base.approvalTimeoutSec,
    ),
    shellTimeoutSec: clampInt(raw.shellTimeoutSec, 1, 3600, base.shellTimeoutSec),
    maxOutputBytes: clampInt(
      raw.maxOutputBytes,
      1024,
      4 * 1024 * 1024,
      base.maxOutputBytes,
    ),
    autoAcceptMaxSec: clampInt(
      raw.autoAcceptMaxSec,
      0,
      HARD_AUTO_ACCEPT_MAX_SEC,
      base.autoAcceptMaxSec,
    ),
    zenityFallback:
      typeof raw.zenityFallback === "boolean" ? raw.zenityFallback : base.zenityFallback,
  };
}

export async function loadConfig(
  homeDir: string = defaultHomeDir(),
  overrides: Partial<ComputerConfig> = {},
): Promise<ComputerConfig> {
  await ensureHome(homeDir);
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(await fs.readFile(configPath(homeDir), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    stored = {};
  }

  const base: ComputerConfig = {
    ...DEFAULT_CONFIG,
    workspace: path.resolve(expandHome(DEFAULT_CONFIG.workspace)),
  };
  const merged = normalizeConfig({ ...stored, ...overrides }, base);
  if (!merged.token) {
    merged.token = crypto.randomBytes(32).toString("base64url");
  }

  await fs.mkdir(merged.workspace, { recursive: true });
  await saveConfig(homeDir, merged);
  await writeToken(homeDir, merged.token);
  return merged;
}

export async function saveConfig(
  homeDir: string,
  config: ComputerConfig,
): Promise<void> {
  await ensureHome(homeDir);
  const file = configPath(homeDir);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(tmp, file);
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // Windows does not implement POSIX modes. The file stays inside the user profile.
  }
}

async function writeToken(homeDir: string, token: string): Promise<void> {
  const file = tokenPath(homeDir);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
  try {
    await fs.chmod(file, 0o600);
  } catch {
    // See saveConfig.
  }
}

export interface PublicConfig {
  workspace: string;
  host: string;
  port: number;
  shellEnabled: boolean;
  approvalTimeoutSec: number;
  shellTimeoutSec: number;
  maxOutputBytes: number;
  autoAcceptMaxSec: number;
  zenityFallback: boolean;
  tokenFile: string;
  configFile: string;
}

export function publicConfig(homeDir: string, config: ComputerConfig): PublicConfig {
  return {
    workspace: config.workspace,
    host: config.host,
    port: config.port,
    shellEnabled: config.shellEnabled,
    approvalTimeoutSec: config.approvalTimeoutSec,
    shellTimeoutSec: config.shellTimeoutSec,
    maxOutputBytes: config.maxOutputBytes,
    autoAcceptMaxSec: config.autoAcceptMaxSec,
    zenityFallback: config.zenityFallback,
    tokenFile: tokenPath(homeDir),
    configFile: configPath(homeDir),
  };
}
