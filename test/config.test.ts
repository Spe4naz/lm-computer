import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  configPath,
  DEFAULT_CONFIG,
  loadConfig,
  type ComputerConfig,
} from "../src/config";

const envKeys = [
  "LM_COMPUTER_HOST",
  "LM_COMPUTER_PORT",
  "LM_COMPUTER_API_ENABLED",
  "LM_COMPUTER_MCP_HOST",
  "LM_COMPUTER_MCP_PORT",
  "LM_COMPUTER_MCP_ENABLED",
];

let savedEnv: Record<string, string | undefined> = {};
let home: string;
let workspace: string;

beforeEach(async () => {
  savedEnv = {};
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  home = await mkdtemp(path.join(os.tmpdir(), "lmc-config-home-"));
  workspace = await mkdtemp(path.join(os.tmpdir(), "lmc-config-ws-"));
});

afterEach(async () => {
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(home, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

describe("config ports", () => {
  it("uses split REST and MCP defaults", async () => {
    const config = await loadConfig(home, { workspace });
    expect(config.port).toBe(DEFAULT_CONFIG.port);
    expect(config.mcpPort).toBe(DEFAULT_CONFIG.mcpPort);
    expect(config.port).not.toBe(config.mcpPort);
    expect(config.apiEnabled).toBe(true);
    expect(config.mcpEnabled).toBe(true);
  });

  it("inherits mcpHost from host when it is not set", async () => {
    await writeFile(
      configPath(home),
      JSON.stringify({ host: "127.0.0.1", port: 2236, workspace }),
    );
    const config = await loadConfig(home);
    expect(config.host).toBe("127.0.0.1");
    expect(config.mcpHost).toBe("127.0.0.1");
  });

  it("keeps an explicit mcpHost and mcpPort", async () => {
    await writeFile(
      configPath(home),
      JSON.stringify({
        host: "0.0.0.0",
        port: 2236,
        mcpHost: "127.0.0.1",
        mcpPort: 2237,
        workspace,
      }),
    );
    const config = await loadConfig(home);
    expect(config.mcpHost).toBe("127.0.0.1");
    expect(config.mcpPort).toBe(2237);
  });

  it("applies per-process environment overrides", async () => {
    process.env.LM_COMPUTER_PORT = "3236";
    process.env.LM_COMPUTER_MCP_PORT = "3237";
    process.env.LM_COMPUTER_MCP_HOST = "127.0.0.1";
    process.env.LM_COMPUTER_API_ENABLED = "false";
    process.env.LM_COMPUTER_MCP_ENABLED = "1";
    const config = await loadConfig(home, { workspace });
    expect(config.port).toBe(3236);
    expect(config.mcpPort).toBe(3237);
    expect(config.mcpHost).toBe("127.0.0.1");
    expect(config.apiEnabled).toBe(false);
    expect(config.mcpEnabled).toBe(true);
  });

  it("does not persist environment overrides to config.json", async () => {
    process.env.LM_COMPUTER_PORT = "3236";
    process.env.LM_COMPUTER_MCP_PORT = "3237";
    const config = await loadConfig(home, { workspace });
    expect(config.port).toBe(3236);
    expect(config.mcpPort).toBe(3237);

    const stored = JSON.parse(await readFile(configPath(home), "utf8")) as ComputerConfig;
    expect(stored.port).toBe(DEFAULT_CONFIG.port);
    expect(stored.mcpPort).toBe(DEFAULT_CONFIG.mcpPort);
  });

  it("lets explicit options win over the environment", async () => {
    process.env.LM_COMPUTER_PORT = "3236";
    const config = await loadConfig(home, { workspace, port: 4236 });
    expect(config.port).toBe(4236);
  });

  it("ignores invalid values and keeps the previous ones", async () => {
    await writeFile(
      configPath(home),
      JSON.stringify({
        port: 2236,
        mcpPort: 2237,
        apiEnabled: "yes",
        mcpEnabled: 1,
        workspace,
      }),
    );
    const config = await loadConfig(home);
    expect(config.port).toBe(2236);
    expect(config.mcpPort).toBe(2237);
    expect(config.apiEnabled).toBe(true);
    expect(config.mcpEnabled).toBe(true);
  });

  it("saves the split ports to config.json", async () => {
    await loadConfig(home, {
      workspace,
      port: 5236,
      mcpPort: 5237,
    } as Partial<ComputerConfig>);
    const stored = JSON.parse(await readFile(configPath(home), "utf8")) as ComputerConfig;
    expect(stored.port).toBe(5236);
    expect(stored.mcpPort).toBe(5237);
    expect(stored.apiEnabled).toBe(true);
    expect(stored.mcpEnabled).toBe(true);
  });
});
