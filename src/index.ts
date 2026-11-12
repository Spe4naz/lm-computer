import type { PluginContext } from "@lmstudio/sdk";
import { toolsProvider } from "./lmstudio";
import { getService } from "./service-singleton";

/**
 * LM Studio starts this function when the plugin is loaded. The HTTP API is
 * started here so the LM Chat app can connect before the first message.
 */
export async function main(context: PluginContext): Promise<void> {
  const service = await getService();

  try {
    const { host, port } = await service.startHttp();
    console.log(`[lm-computer] REST/MCP listening on http://${host}:${port}`);
    console.log(`[lm-computer] workspace: ${service.files.root}`);
    console.log(`[lm-computer] token file: ${service.publicConfig().tokenFile}`);
  } catch (error) {
    console.error(
      `[lm-computer] HTTP server failed to start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  context.withToolsProvider(toolsProvider);
}
