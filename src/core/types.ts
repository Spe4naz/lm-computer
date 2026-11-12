import type { z } from "zod";

export type ToolOrigin = "lmstudio" | "mcp" | "api";

export interface ToolCallContext {
  origin: ToolOrigin;
  signal?: AbortSignal;
  /** Shows a short progress line in the LM Studio chat. */
  status?: (message: string) => void;
}

export interface ToolResult {
  text: string;
  data?: unknown;
}

export type ToolRisk = "low" | "medium" | "high";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, z.ZodTypeAny>;
  risk: ToolRisk;
  /** "always" asks for confirmation unless a temporary auto-accept is active. */
  approval: "never" | "always";
  approvalDetails?: (args: Record<string, unknown>) => {
    summary: string;
    details: Record<string, unknown>;
  };
  handler: (args: Record<string, unknown>, ctx: ToolCallContext) => Promise<ToolResult>;
}
