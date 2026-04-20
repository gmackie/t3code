import { Context } from "effect";

import type { ServerProviderShape } from "./ServerProvider.ts";

export interface SmolAgentProviderShape extends ServerProviderShape {}

export class SmolAgentProvider extends Context.Service<SmolAgentProvider, SmolAgentProviderShape>()(
  "t3/provider/Services/SmolAgentProvider",
) {}
