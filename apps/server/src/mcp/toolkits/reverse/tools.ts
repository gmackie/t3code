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
  ReverseToolchainResult,
  ReverseFindingCreateInput,
  ReverseImportExtractedInput,
  ReverseDiffInput,
  ReverseCapture,
  ReverseCaptureDecodeInput,
  ReverseCaptureDecodeResult,
  ReverseCaptureImportInput,
  ReverseCaptureViewInput,
  ReverseCaptureViewResult,
  ReverseSerialPortsInput,
  ReverseSerialPortsResult,
  ReverseSerialRecentInput,
  ReverseSerialRecentResult,
  VeritasReQueryInput,
  VeritasReQueryResult,
  ReverseDiffResult,
  ReverseFindingRecord,
  ReverseFindingUpdateInput,
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

const ReverseToolchainTool = Tool.make("t3_reverse_toolchain", {
  ...shared,
  description:
    "Report which native reverse-engineering tools this environment can run (sandbox launcher, Ghidra, Java, binwalk, unblob, ROPgadget, rea, QEMU), which analyses each enables, and how to install what is missing. Nothing is executed to find out.",
  success: ReverseToolchainResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseImportExtractedTool = Tool.make("t3_reverse_import_extracted", {
  ...shared,
  description:
    "Open one file from an Unblob extraction (receiptId and path from a t3_reverse_analyze unblob result) as its own investigation, linked to the parent firmware. Use it to analyze an ELF or filesystem found inside a vendor image.",
  parameters: ReverseImportExtractedInput,
  success: ReverseImportResult,
}).annotate(Tool.Destructive, false);

const ReverseDiffTool = Tool.make("t3_reverse_diff", {
  ...shared,
  description:
    "Compare the functions of two investigations in the same project, such as two firmware versions, through their Ghidra programs. Reports counts of identical, relocated, changed, added and removed functions and lists the ones that differ. Matching uses names Ghidra did not invent, then unique instruction shapes.",
  parameters: ReverseDiffInput,
  success: ReverseDiffResult,
}).annotate(Tool.Destructive, false);

const VeritasReQueryTool = Tool.make("t3_veritas_re_query", {
  ...shared,
  description:
    "Read hardware reverse-engineering data from the Veritas server this environment is connected to, with the environment's credentials: boards, revisions, signals and probe maps (reBoards.*), logic-analyzer captures (reCaptures.list and get), pulse decoder presets (reAnalysis.pulsePresets), hypotheses, annotations, custom protocols, and registered firmware with its findings and experiments (reFirmware.*). Pass the procedure's input object as `input`, for example { boardId } for reBoards.get or { sha256 } for reFirmware.listFindings. Read-only; nothing is changed in Veritas.",
  parameters: VeritasReQueryInput,
  success: VeritasReQueryResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

const ReverseCaptureImportTool = Tool.make("t3_reverse_capture_import", {
  ...shared,
  description:
    "Import a logic-analyzer capture from the project workspace: VCD (.vcd), sigrok session (.sr), or a Saleae Logic 2 export (digital_N.bin, a zip of them, or the digital CSV). Saleae .sal files are not read; export from Logic 2 instead. Returns the capture with its channel names and duration; t3_reverse_list lists captures.",
  parameters: ReverseCaptureImportInput,
  success: ReverseCapture,
}).annotate(Tool.Destructive, false);

const ReverseCaptureViewTool = Tool.make("t3_reverse_capture_view", {
  ...shared,
  description:
    "Read a time window of a capture: each channel's level at the window start and its edge times in nanoseconds, or busy spans where the window is too dense. Narrow the window to see individual edges.",
  parameters: ReverseCaptureViewInput,
  success: ReverseCaptureViewResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseCaptureDecodeTool = Tool.make("t3_reverse_capture_decode", {
  ...shared,
  description:
    "Decode a capture's channels as UART (signal, baud, optional data bits, parity, stop bits, inversion), SPI (clk with mosi and/or miso, optional active-low cs, cpol, cpha, word size, bit order) or I2C (sda, scl), optionally within a time range. Returns timed events with readable text; truncated says the limit was reached.",
  parameters: ReverseCaptureDecodeInput,
  success: ReverseCaptureDecodeResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseSerialPortsTool = Tool.make("t3_reverse_serial_ports", {
  ...shared,
  description:
    "List serial ports on this environment's host and the serial sessions a person has open in this project. Agents can read open sessions but not open ports or send to them.",
  parameters: ReverseSerialPortsInput,
  success: ReverseSerialPortsResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseSerialReadTool = Tool.make("t3_reverse_serial_read", {
  ...shared,
  description:
    "Read the most recent output (as UTF-8 text) of a serial session a person opened in the Reverse workspace, up to maxBytes (default 8192). lastSeq identifies the newest chunk returned.",
  parameters: ReverseSerialRecentInput,
  success: ReverseSerialRecentResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ReverseFindingCreateTool = Tool.make("t3_reverse_finding_create", {
  ...shared,
  description:
    "Record a candidate finding on an investigation (gadget, memory-corruption, attack-surface, boot-chain, crypto, protocol, other) with evidence: code locations in this firmware, capture windows, or QEMU runs. Findings are hypotheses for a person to review; they start as candidates and are recorded as agent-authored.",
  parameters: ReverseFindingCreateInput,
  success: ReverseFindingRecord,
}).annotate(Tool.Destructive, false);

const ReverseFindingUpdateTool = Tool.make("t3_reverse_finding_update", {
  ...shared,
  description:
    "Reject or supersede a finding, for example when new evidence contradicts it. Agents cannot mark a finding probable or confirmed; a person does that in the workspace.",
  parameters: ReverseFindingUpdateInput,
  success: ReverseFindingRecord,
}).annotate(Tool.Destructive, false);

export const ReverseToolkit = Toolkit.make(
  ReverseToolchainTool,
  ReverseImportExtractedTool,
  ReverseDiffTool,
  ReverseCaptureImportTool,
  ReverseCaptureViewTool,
  ReverseCaptureDecodeTool,
  ReverseSerialPortsTool,
  ReverseSerialReadTool,
  VeritasReQueryTool,
  ReverseFindingCreateTool,
  ReverseFindingUpdateTool,
  ReverseListTool,
  ReverseStringsTool,
  ReverseImportTool,
  ReverseLinkTool,
  ReverseAnalyzeTool,
  ReverseEmulateTool,
);
