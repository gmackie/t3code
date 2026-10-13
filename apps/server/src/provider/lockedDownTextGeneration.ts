import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { TextGeneration } from "../textGeneration/TextGeneration.ts";

export function restrictTextGeneration(
  service: TextGeneration["Service"],
  allowed: ReadonlySet<string>,
): TextGeneration["Service"] {
  const check = (model: string) =>
    allowed.has(model)
      ? Effect.void
      : Effect.fail(
          new TextGenerationError({
            operation: "selectModel",
            detail: "Model is outside the configured Workers AI allowlist.",
          }),
        );
  return {
    generateCommitMessage: (input) =>
      check(input.modelSelection.model).pipe(
        Effect.andThen(Effect.suspend(() => service.generateCommitMessage(input))),
      ),
    generatePrContent: (input) =>
      check(input.modelSelection.model).pipe(
        Effect.andThen(Effect.suspend(() => service.generatePrContent(input))),
      ),
    generateBranchName: (input) =>
      check(input.modelSelection.model).pipe(
        Effect.andThen(Effect.suspend(() => service.generateBranchName(input))),
      ),
    generateThreadTitle: (input) =>
      check(input.modelSelection.model).pipe(
        Effect.andThen(Effect.suspend(() => service.generateThreadTitle(input))),
      ),
  };
}
