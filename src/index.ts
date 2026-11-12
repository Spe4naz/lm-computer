import type { PluginContext } from "@lmstudio/sdk";
import { toolsProvider } from "./lmstudio";
import { logListeners } from "./log";
import { getService } from "./service-singleton";

function pluginHttpEnabled(): boolean {
  const value = process.env.LM_COMPUTER_PLUGIN_HTTP?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * LM Studio starts this function when the plugin is loaded. By default the
 * plugin only registers native tools: LM Studio can evict plugin processes at
 * any time, so REST/MCP live in the always-on lm-computer.service instead.
 */
export async function main(context: PluginContext): Promise<void> {
  const service = await getService();

  if (pluginHttpEnabled()) {
    try {
      const listeners = await service.startHttp();
      logListeners(listeners);
      console.log(`[lm-computer] workspace: ${service.files.root}`);
      console.log(`[lm-computer] token file: ${service.publicConfig().tokenFile}`);
    } catch (error) {
      console.error(
        `[lm-computer] HTTP server failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    console.log(
      "[lm-computer] native tools only; REST/MCP are served by lm-computer.service",
    );
  }

  context.withToolsProvider(toolsProvider);
}
