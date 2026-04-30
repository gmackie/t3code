#!/usr/bin/env node

import { parseT3StateSyncCliArgs, syncT3State } from "./stateSync.ts";

function printUsage(): void {
  console.log(`Usage: node apps/server/src/stateSyncCli.ts --from <stable|gmacko|path> --to <stable|gmacko|path> [--dry-run] [--include-logs]

Examples:
  node apps/server/src/stateSyncCli.ts --from stable --to gmacko
  node apps/server/src/stateSyncCli.ts --from gmacko --to stable --dry-run
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const parsed = parseT3StateSyncCliArgs(args);
  const result = await syncT3State(parsed);
  const action = parsed.dryRun ? "Would copy" : "Copied";

  console.log(`${action} ${result.copiedFiles.length} state file(s).`);
  if (result.skippedFiles.length > 0) {
    console.log(
      `Skipped ${result.skippedFiles.length} file(s). Use --include-logs to include logs.`,
    );
  }
  console.log(`From: ${parsed.sourceStateDir}`);
  console.log(`To:   ${parsed.targetStateDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
