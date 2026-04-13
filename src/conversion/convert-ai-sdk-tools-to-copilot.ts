import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider";
import type { Tool } from "@github/copilot-sdk";
import { defineTool } from "@github/copilot-sdk";

const PROVIDER_KEY = "github-copilot";

type CopilotProviderOptions = { execute?: (args: unknown) => unknown | Promise<unknown>; };

function hasExecute(opts: unknown): opts is CopilotProviderOptions & { execute: (args: unknown) => unknown | Promise<unknown> } {
  return opts != null && typeof opts === "object" && "execute" in opts && typeof (opts as CopilotProviderOptions).execute === "function";
}

export function convertAiSdkToolsToCopilotTools(
  tools: Array<LanguageModelV3FunctionTool | { type: string; name: string }> | undefined,
): Tool<unknown>[] {
  if (!tools?.length) return [];
  const result: Tool<unknown>[] = [];
  for (const tool of tools) {
    if (tool.type !== "function" || !("inputSchema" in tool)) continue;
    const copilotOpts = tool.providerOptions?.[PROVIDER_KEY];
    if (!hasExecute(copilotOpts)) continue;
    const execute = copilotOpts.execute;
    const copilotTool = defineTool(tool.name, {
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
      handler: async (args: unknown) => execute(args),
    });
    result.push(copilotTool);
  }
  return result;
}
