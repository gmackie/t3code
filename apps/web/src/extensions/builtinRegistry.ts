import { planningWorkbenchExtension } from "./builtins/planningWorkbench";
import { threadOverviewExtension } from "./builtins/threadOverview";

export const BUILTIN_EXTENSIONS = [planningWorkbenchExtension, threadOverviewExtension] as const;
