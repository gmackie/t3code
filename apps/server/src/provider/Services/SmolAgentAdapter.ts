import { Context } from "effect";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface SmolAgentAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {
  readonly provider: "smolAgent";
}

export class SmolAgentAdapter extends Context.Service<SmolAgentAdapter, SmolAgentAdapterShape>()(
  "t3/provider/Services/SmolAgentAdapter",
) {}
