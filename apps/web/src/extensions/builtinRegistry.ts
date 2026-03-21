import { browserExtension } from "./builtins/browserExtension";
import { planningWorkbenchExtension } from "./builtins/planningWorkbench";
import { threadOverviewExtension } from "./builtins/threadOverview";

export const BUILTIN_EXTENSIONS = [
  threadOverviewExtension,
  planningWorkbenchExtension,
  browserExtension,
] as const;
