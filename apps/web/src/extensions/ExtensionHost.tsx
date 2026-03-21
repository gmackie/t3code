import { useEffect, useMemo, useState } from "react";

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
  const [activeExtensionId, setActiveExtensionId] = useState<string | null>(
    availableExtensions[0]?.id ?? null,
  );

  useEffect(() => {
    if (availableExtensions.length === 0) {
      setActiveExtensionId(null);
      return;
    }
    if (!availableExtensions.some((extension) => extension.id === activeExtensionId)) {
      setActiveExtensionId(availableExtensions[0]?.id ?? null);
    }
  }, [activeExtensionId, availableExtensions]);

  const activeExtension =
    availableExtensions.find((extension) => extension.id === activeExtensionId) ?? null;

  if (!props.open || availableExtensions.length === 0 || !activeExtension) {
    return null;
  }

  return (
    <ExtensionSidePanel
      extensions={availableExtensions}
      activeExtensionId={activeExtension.id}
      onSelectExtension={setActiveExtensionId}
      onClose={props.onClose}
    >
      {activeExtension.render(props.context)}
    </ExtensionSidePanel>
  );
}
