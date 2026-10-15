import {
  OrchestratorMcpFailure,
  ReverseAnalysisInput,
  ReverseAnalysisResult,
  ReverseEmulateInput,
  ReverseEmulateResult,
  ReverseImportInput,
  ReverseImportResult,
  ReverseInvestigation,
  ReverseLinkInput,
  ReverseListInput,
  ReverseListResult,
  ReverseStringsInput,
  ReverseStringsResult,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ReverseWorkbench from "../../../reverse/ReverseWorkbench.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

// Publishing to Veritas and deleting investigations stay human actions in the workspace.
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ReverseWorkbench.ReverseWorkbench,
  ],
};

const ReverseListTool = Tool.make("t3_reverse_list", {
  ...shared,
  description:
    "List a project's firmware investigations and their imported artifacts (SHA-256, size, source path).",
  parameters: ReverseListInput,
  success: ReverseListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseStringsTool = Tool.make("t3_reverse_strings", {
  ...shared,
  description:
    "Printable ASCII strings in an investigation's firmware with their file offsets. Values are capped at 512 characters and results at 2000 strings; truncated says when the scan stopped early.",
  parameters: ReverseStringsInput,
  success: ReverseStringsResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseImportTool = Tool.make("t3_reverse_import", {
  ...shared,
  description:
    "Import a firmware file from the project workspace into an immutable, content-addressed investigation. relativePath must stay inside the workspace. Importing the same bytes again returns the existing investigation.",
  parameters: ReverseImportInput,
  success: ReverseImportResult,
}).annotate(Tool.Destructive, false);

const ReverseLinkTool = Tool.make("t3_reverse_link", {
  ...shared,
  description:
    "Record the Veritas project and board revision an investigation belongs to. An omitted field is unchanged; null clears it. This does not publish anything.",
  parameters: ReverseLinkInput,
  success: ReverseInvestigation,
}).annotate(Tool.Destructive, false);

const ReverseAnalyzeTool = Tool.make("t3_reverse_analyze", {
  ...shared,
  description:
    "Run a native analyzer on an investigation in the environment's sandbox: posture (ELF layout), gadgets (ROP/JOP/COP candidates; give rawArch/rawMode/rawEndian for raw images), binwalk, unblob (extraction), rea, or ghidra (a persistent session: list functions, read one function's pseudocode and instructions, rename, comment, save, close). Results are candidates and observations, never validated findings.",
  parameters: ReverseAnalysisInput,
  success: ReverseAnalysisResult,
}).annotate(Tool.Destructive, false);

const ReverseEmulateTool = Tool.make("t3_reverse_emulate", {
  ...shared,
  description:
    "Boot an investigation's firmware in QEMU for a few seconds with no network and capture its serial output. The outcome is a QEMU observation, not physical evidence.",
  parameters: ReverseEmulateInput,
  success: ReverseEmulateResult,
}).annotate(Tool.Destructive, false);

export const ReverseToolkit = Toolkit.make(
  ReverseListTool,
  ReverseStringsTool,
  ReverseImportTool,
  ReverseLinkTool,
  ReverseAnalyzeTool,
  ReverseEmulateTool,
);
