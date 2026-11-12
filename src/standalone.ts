import { ComputerService } from "./core/service";
import { logListeners } from "./log";

async function main(): Promise<void> {
  const service = await ComputerService.create();
  const listeners = await service.startHttp();
  const config = service.publicConfig();

  console.log("LM Computer standalone service");
  logListeners(listeners);
  console.log(`  workspace: ${service.files.root}`);
  console.log(`  token file: ${config.tokenFile}`);
  console.log(`  config file: ${config.configFile}`);

  if (!listeners.api.listening && !listeners.mcp.listening) {
    console.error("No HTTP listener started; check the config and ports.");
    process.exit(1);
  }
  console.log("Press Ctrl+C to stop.");

  const shutdown = async (): Promise<void> => {
    await service.stopHttp();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
