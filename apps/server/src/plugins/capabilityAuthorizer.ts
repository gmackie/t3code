import type { PluginCapabilityRequest } from "@t3tools/contracts";

export type T3CapabilityOperation =
  | { kind: "events.read"; eventType: string; projectId?: string; threadId?: string }
  | { kind: "threads.read"; projectId?: string; threadId?: string }
  | { kind: "threads.dispatch"; projectId?: string }
  | { kind: "filesystem.read" | "filesystem.write"; path: string }
  | { kind: "secrets.read"; name: string }
  | { kind: "network.connect"; host: string }
  | { kind: "ui.embed"; surface: "settings" | "project" | "thread.sidePanel" | "thread.main" }
  | { kind: "provider.control"; providerInstanceId?: string };

export class CapabilityAuthorizer {
  #grants = new Map<string, PluginCapabilityRequest[]>();

  grant(pluginId: string, capability: PluginCapabilityRequest): void {
    const grants = this.#grants.get(pluginId) ?? [];
    if (!grants.some((existing) => JSON.stringify(existing) === JSON.stringify(capability))) {
      this.#grants.set(pluginId, [...grants, capability]);
    }
  }

  revoke(pluginId: string, capability?: PluginCapabilityRequest): void {
    if (capability === undefined) {
      this.#grants.delete(pluginId);
      return;
    }
    this.#grants.set(
      pluginId,
      (this.#grants.get(pluginId) ?? []).filter(
        (existing) => JSON.stringify(existing) !== JSON.stringify(capability),
      ),
    );
  }

  hasGrant(pluginId: string, capability: PluginCapabilityRequest): boolean {
    return (this.#grants.get(pluginId) ?? []).some(
      (existing) => JSON.stringify(existing) === JSON.stringify(capability),
    );
  }

  authorize(pluginId: string, operation: T3CapabilityOperation): boolean {
    return (this.#grants.get(pluginId) ?? []).some((grant) => this.#covers(grant, operation));
  }

  #covers(grant: PluginCapabilityRequest, operation: T3CapabilityOperation): boolean {
    if (grant.kind !== operation.kind) return false;
    switch (grant.kind) {
      case "events.read":
        return (
          grant.eventTypes.includes(
            (operation as Extract<T3CapabilityOperation, { kind: "events.read" }>).eventType,
          ) &&
          this.#scopeIncludes(
            grant.projectIds,
            (operation as Extract<T3CapabilityOperation, { kind: "events.read" }>).projectId,
          ) &&
          this.#scopeIncludes(
            grant.threadIds,
            (operation as Extract<T3CapabilityOperation, { kind: "events.read" }>).threadId,
          )
        );
      case "threads.read":
        return (
          this.#scopeIncludes(
            grant.projectIds,
            (operation as Extract<T3CapabilityOperation, { kind: "threads.read" }>).projectId,
          ) &&
          this.#scopeIncludes(
            grant.threadIds,
            (operation as Extract<T3CapabilityOperation, { kind: "threads.read" }>).threadId,
          )
        );
      case "threads.dispatch":
        return this.#scopeIncludes(
          grant.projectIds,
          (operation as Extract<T3CapabilityOperation, { kind: "threads.dispatch" }>).projectId,
        );
      case "filesystem.read":
      case "filesystem.write":
        return grant.roots.some((root) => {
          const path = (
            operation as Extract<
              T3CapabilityOperation,
              { kind: "filesystem.read" | "filesystem.write" }
            >
          ).path;
          return path === root || path.startsWith(`${root}/`);
        });
      case "secrets.read":
        return grant.names.includes(
          (operation as Extract<T3CapabilityOperation, { kind: "secrets.read" }>).name,
        );
      case "network.connect":
        return (
          grant.hosts.includes("*") ||
          grant.hosts.includes(
            (operation as Extract<T3CapabilityOperation, { kind: "network.connect" }>).host,
          )
        );
      case "ui.embed":
        return grant.surfaces.includes(
          (operation as Extract<T3CapabilityOperation, { kind: "ui.embed" }>).surface,
        );
      case "provider.control":
        return (operation as Extract<T3CapabilityOperation, { kind: "provider.control" }>)
          .providerInstanceId === undefined
          ? grant.providerInstanceIds === undefined
          : grant.providerInstanceIds === undefined ||
              grant.providerInstanceIds.includes(
                (operation as Extract<T3CapabilityOperation, { kind: "provider.control" }>)
                  .providerInstanceId!,
              );
    }
  }

  #scopeIncludes(scope: readonly string[] | undefined, value: string | undefined): boolean {
    return scope === undefined || (value !== undefined && scope.includes(value));
  }
}
