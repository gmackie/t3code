import type {
  WorkItem,
  WorkItemDetail,
  WorkItemScope,
  WorkSourceCapability,
} from "@t3tools/contracts";

import type { WorkSourceProvider } from "./workSource.ts";

type LegacyProvider<Raw> = {
  list(scope: WorkItemScope): Promise<readonly Raw[]>;
  get(itemId: string): Promise<Raw>;
};

export const makeCompatibilityWorkSourceProvider = <Raw>(input: {
  id: string;
  displayName: string;
  capabilities: readonly WorkSourceCapability[];
  legacy: LegacyProvider<Raw>;
  normalizeItem(raw: Raw): WorkItem;
  normalizeDetail?(raw: Raw): WorkItemDetail;
}): WorkSourceProvider => ({
  id: input.id,
  displayName: input.displayName,
  capabilities: input.capabilities,
  getStatus: async () => ({ state: "connected" }),
  list: async (scope) => (await input.legacy.list(scope)).map(input.normalizeItem),
  get: async (itemId) => {
    const raw = await input.legacy.get(itemId);
    return input.normalizeDetail?.(raw) ?? { item: input.normalizeItem(raw) };
  },
});
