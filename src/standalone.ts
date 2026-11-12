import { ComputerService } from "./core/service";

async function main(): Promise<void> {
  const service = await ComputerService.create();
  const { host, port } = await service.startHttp();
  const config = service.publicConfig();
  console.log("LM Computer standalone service");
  console.log(`  REST/MCP: http://${host}:${port}`);
  console.log(`  workspace: ${service.files.root}`);
  console.log(`  token file: ${config.tokenFile}`);
  console.log(`  config file: ${config.configFile}`);
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
