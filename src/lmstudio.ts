import { tool, type Tool, type ToolsProviderController } from "@lmstudio/sdk";
import { getService } from "./service-singleton";

export async function toolsProvider(ctl: ToolsProviderController): Promise<Tool[]> {
  const service = await getService();

  return service.toolSpecs.map((spec) =>
    tool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      implementation: async (args, { status, signal }) => {
        const result = await service.executeTool(spec.name, args as Record<string, unknown>, {
          origin: "lmstudio",
          status: (message) => status(message),
          signal,
        });
        return result.text;
      },
    }),
  );
}
