import type { LanguageModelV3FinishReason } from "@ai-sdk/provider";

export function mapCopilotFinishReason(): LanguageModelV3FinishReason {
  return { unified: "stop", raw: undefined };
}
