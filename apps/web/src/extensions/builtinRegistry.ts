import { browserExtension } from "./builtins/browserExtension";
import { planningWorkbenchExtension } from "./builtins/planningWorkbench";
import { previewWorkspaceExtension } from "./builtins/previewWorkspace";
import { threadOverviewExtension } from "./builtins/threadOverview";

export const BUILTIN_EXTENSIONS = [
  threadOverviewExtension,
  planningWorkbenchExtension,
  previewWorkspaceExtension,
  browserExtension,
] as const;
