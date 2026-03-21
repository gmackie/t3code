import { useMemo, useState } from "react";

import { ExtensionSidePanel } from "./ExtensionSidePanel";
import { getAvailableExtensionsForSurface } from "./registry";
import type { ExtensionContext, T3ExtensionDefinition } from "./types";

interface ExtensionHostProps {
  extensions: ReadonlyArray<T3ExtensionDefinition>;
  context: ExtensionContext;
  open: boolean;
  onClose: () => void;
}

export function ExtensionHost(props: ExtensionHostProps) {
  const availableExtensions = useMemo(
    () => getAvailableExtensionsForSurface(props.extensions, "thread.sidePanel", props.context),
    [props.context, props.extensions],
  );
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);

  // Derive the active extension: use selected if still available, otherwise first available
  const activeExtension = useMemo(() => {
    if (availableExtensions.length === 0) return null;
    if (selectedExtensionId) {
      const selected = availableExtensions.find((ext) => ext.id === selectedExtensionId);
      if (selected) return selected;
    }
    return availableExtensions[0] ?? null;
  }, [availableExtensions, selectedExtensionId]);

  if (!props.open || !activeExtension) {
    return null;
  }

  return (
    <ExtensionSidePanel
      extensions={availableExtensions}
      activeExtensionId={activeExtension.id}
      onSelectExtension={setSelectedExtensionId}
      onClose={props.onClose}
    >
      {activeExtension.render(props.context)}
    </ExtensionSidePanel>
  );
}
