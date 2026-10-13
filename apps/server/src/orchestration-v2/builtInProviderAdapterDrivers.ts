import type { ProviderDriverKind } from "@t3tools/contracts";
import { OpenCodeAdapterV2Driver } from "./Adapters/OpenCodeAdapterV2.ts";
export const BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2: ReadonlySet<ProviderDriverKind> = new Set([
  OpenCodeAdapterV2Driver.driverKind,
]);
