import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface ComputerConfig {
  /** Workspace the file tools are allowed to touch. */
  workspace: string;
  /** REST API bind address. 0.0.0.0 makes the approval console reachable on the LAN. */
  host: string;
  /** REST API port used by LM Chat and stop.sh. */
  port: number;
  /** Serve the REST API listener. */
  apiEnabled: boolean;
  /** MCP bind address. Falls back to `host` when empty. */
  mcpHost: string;
  /** MCP port used by opencode and other MCP clients. */
  mcpPort: number;
  /** Serve the MCP listener. */
  mcpEnabled: boolean;
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
  apiEnabled: true,
  mcpHost: "0.0.0.0",
  mcpPort: 1237,
  mcpEnabled: true,
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

export class WorkspaceNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNotAllowedError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel =
    process.platform === "win32"
      ? path.relative(root.toLowerCase(), candidate.toLowerCase())
      : path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Roots the workspace may live under. By default only the current user's home
 * directory; set `LM_COMPUTER_ALLOWED_ROOTS` (path-delimiter separated) for
 * e.g. an external drive. The filesystem root is never accepted.
 */
export function allowedWorkspaceRoots(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const roots = [path.resolve(os.homedir())];
  const extra = env.LM_COMPUTER_ALLOWED_ROOTS?.trim();
  if (extra) {
    for (const part of extra.split(path.delimiter)) {
      const value = part.trim();
      if (value) roots.push(path.resolve(expandHome(value)));
    }
  }
  return roots;
}

/**
 * Rejects a workspace change that would turn `fs_write`/`fs_append` into
 * unrestricted writes. `PUT /api/config` used to accept `/`.
 */
export function assertWorkspaceAllowed(
  workspace: string,
  roots: string[] = allowedWorkspaceRoots(),
): string {
  const resolved = path.resolve(expandHome(workspace));
  const filesystemRoot = path.parse(resolved).root;
  if (resolved === filesystemRoot) {
    throw new WorkspaceNotAllowedError(
      "Workspace cannot be the filesystem root. Choose a directory inside your home folder.",
    );
  }
  if (!roots.some((root) => isInside(path.resolve(root), resolved))) {
    throw new WorkspaceNotAllowedError(
      `Workspace must stay inside an allowed root (${roots.join(", ")}). ` +
        "Set LM_COMPUTER_ALLOWED_ROOTS to allow another location.",
    );
  }
  return resolved;
}

/**
 * Resolves the deepest existing ancestor and appends the missing tail. The
 * caller can validate the real location before `mkdir()` follows a symlinked
 * parent.
 */
export async function resolveWorkspaceRealPath(workspace: string): Promise<string> {
  let current = path.resolve(expandHome(workspace));
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.push(path.basename(current));
      current = parent;
    }
  }
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

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envInt(name: string): number | undefined {
  const value = envString(name);
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function envBool(name: string): boolean | undefined {
  const value = envString(name)?.toLowerCase();
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

/**
 * Per-process overrides. Useful for running a second (DEV) instance with its
 * own ports and home directory next to the installed plugin.
 */
export function configEnvOverrides(): Partial<ComputerConfig> {
  const env: Partial<ComputerConfig> = {};
  const host = envString("LM_COMPUTER_HOST");
  if (host !== undefined) env.host = host;
  const port = envInt("LM_COMPUTER_PORT");
  if (port !== undefined) env.port = port;
  const apiEnabled = envBool("LM_COMPUTER_API_ENABLED");
  if (apiEnabled !== undefined) env.apiEnabled = apiEnabled;
  const mcpHost = envString("LM_COMPUTER_MCP_HOST");
  if (mcpHost !== undefined) env.mcpHost = mcpHost;
  const mcpPort = envInt("LM_COMPUTER_MCP_PORT");
  if (mcpPort !== undefined) env.mcpPort = mcpPort;
  const mcpEnabled = envBool("LM_COMPUTER_MCP_ENABLED");
  if (mcpEnabled !== undefined) env.mcpEnabled = mcpEnabled;
  return env;
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
  const mcpHost =
    typeof raw.mcpHost === "string" && raw.mcpHost.trim().length > 0
      ? raw.mcpHost.trim()
      : host;
  const token =
    typeof raw.token === "string" && raw.token.trim().length > 0
      ? raw.token.trim()
      : base.token;
  return {
    workspace,
    host,
    port: clampInt(raw.port, 1, 65535, base.port),
    apiEnabled:
      typeof raw.apiEnabled === "boolean" ? raw.apiEnabled : base.apiEnabled,
    mcpHost,
    mcpPort: clampInt(raw.mcpPort, 1, 65535, base.mcpPort),
    mcpEnabled:
      typeof raw.mcpEnabled === "boolean" ? raw.mcpEnabled : base.mcpEnabled,
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
  // Per-process overrides (env) must not leak into config.json: a DEV instance
  // started with LM_COMPUTER_PORT=1246 should not rewrite the installed profile.
  const persisted = normalizeConfig({ ...stored, ...overrides }, base);
  if (!persisted.token) {
    persisted.token = crypto.randomBytes(32).toString("base64url");
  }
  const merged = normalizeConfig(
    { ...persisted, ...configEnvOverrides(), ...overrides },
    base,
  );
  merged.token = persisted.token;

  await fs.mkdir(merged.workspace, { recursive: true });
  await saveConfig(homeDir, persisted);
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
  apiEnabled: boolean;
  mcpHost: string;
  mcpPort: number;
  mcpEnabled: boolean;
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
    apiEnabled: config.apiEnabled,
    mcpHost: config.mcpHost,
    mcpPort: config.mcpPort,
    mcpEnabled: config.mcpEnabled,
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
