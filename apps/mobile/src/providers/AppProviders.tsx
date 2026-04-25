import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { runDevAutoPairingOnce } from "../lib/devAutoPairing";
import { pairEnvironmentFromUrl } from "../lib/pairing";
import {
  hydrateEnvironmentStore,
  listEnvironmentRecords,
  savePairedEnvironment,
} from "../state/environmentStore";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    void runDevAutoPairingOnce({
      pairingUrl: process.env.EXPO_PUBLIC_T3_MOBILE_PAIRING_URL,
      hydrateEnvironmentStore,
      listEnvironmentRecords,
      pairEnvironmentFromUrl,
      savePairedEnvironment,
    }).catch((error) => {
      console.error("[mobile] dev auto-pair failed", error);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}
