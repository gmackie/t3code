import React from "react";
import ReactDOM from "react-dom/client";

import "@fontsource-variable/inter";
import "./index.css";

import { trackKeyboardLayout } from "./keyboardLayout";
import { hasCloudPublicConfig, isOidcCloudConfig } from "./cloud/publicConfig";
import { isElectron } from "./env";
import { startAppServices } from "./appInit";
import { AppRoot } from "./AppRoot";
import { whenLocaleReady } from "./i18n/runtime";
import { chunkLoadState } from "./lib/chunkReloadGuard";

const stopTrackingKeyboardLayout = trackKeyboardLayout();
import.meta.hot?.dispose(stopTrackingKeyboardLayout);

const router = startAppServices();

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const oidcCloud = isOidcCloudConfig();

const app = <AppRoot router={router} />;

// Nathan builds never load Clerk. Other builds still split so clerk-js stays out of local startup.
const managedAuthShellModule = oidcCloud
  ? import("./cloud/NathanAuthShell")
  : clerkPublishableKey && hasCloudPublicConfig()
    ? isElectron
      ? import("./components/clerk/ElectronManagedAuthShell")
      : import("./components/clerk/BrowserManagedAuthShell")
    : null;

export const startup = Promise.all([
  managedAuthShellModule?.then((module) => module.default) ?? null,
  // Chained so settings have usually hydrated; English resolves without a chunk load.
  router.load().then(whenLocaleReady),
])
  .then(([loadedShell]) => {
    // Route chunk failures resolve router.load() and surface later through the error boundary.
    if (chunkLoadState.reloadScheduled) return;
    const ManagedAuthShell = loadedShell as React.ComponentType<{
      readonly children?: React.ReactNode;
      readonly publishableKey?: string;
    }> | null;
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {ManagedAuthShell ? (
          clerkPublishableKey && !oidcCloud ? (
            <ManagedAuthShell publishableKey={clerkPublishableKey}>{app}</ManagedAuthShell>
          ) : (
            <ManagedAuthShell>{app}</ManagedAuthShell>
          )
        ) : (
          app
        )}
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (chunkLoadState.reloadScheduled) return;
    throw error;
  });
