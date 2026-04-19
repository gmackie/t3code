import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserImportCookiesInput,
  BrowserImportCookiesResult,
  BrowserCookieDomain,
  BrowserCookieProfile,
  BrowserCookieSource,
  BrowserRemoveCookieDomainResult,
  BrowserSessionCookie,
  DesktopBridge,
} from "@t3tools/contracts";

type BrowserCookieBridge = {
  browserListCookieSources: () => Promise<BrowserCookieSource[]>;
  browserListCookieProfiles: (sourceId: string) => Promise<BrowserCookieProfile[]>;
  browserListCookieDomains: (input: {
    sourceId: string;
    profileId: string;
    search?: string;
  }) => Promise<BrowserCookieDomain[]>;
  browserImportCookies: (input: BrowserImportCookiesInput) => Promise<BrowserImportCookiesResult>;
  browserListSessionCookies: () => Promise<BrowserSessionCookie[]>;
  browserRemoveCookieDomain: (domain: string) => Promise<BrowserRemoveCookieDomainResult>;
};

function getDesktopBridgeCookieApi(): BrowserCookieBridge | null {
  const bridge = window.desktopBridge;
  if (
    !bridge?.browserListCookieSources ||
    !bridge.browserListCookieProfiles ||
    !bridge.browserListCookieDomains ||
    !bridge.browserImportCookies ||
    !bridge.browserListSessionCookies ||
    !bridge.browserRemoveCookieDomain
  ) {
    return null;
  }
  return bridge as DesktopBridge & BrowserCookieBridge;
}

function deriveInitialSearchFromUrl(url: string | null): string {
  if (!url || url === "about:blank") {
    return "";
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

interface UseBrowserCookieManagerOptions {
  enabled: boolean;
  activeUrl: string | null;
}

interface BrowserCookieManagerState {
  isAvailable: boolean;
  availableSources: BrowserCookieSource[];
  selectedSourceId: string | null;
  availableProfiles: BrowserCookieProfile[];
  selectedProfileId: string | null;
  sourceSearch: string;
  sourceDomains: BrowserCookieDomain[];
  sessionCookies: BrowserSessionCookie[];
  isLoadingSources: boolean;
  isLoadingDomains: boolean;
  isImporting: boolean;
  isRemoving: boolean;
  onSourceChange: (sourceId: string) => void;
  onProfileChange: (profileId: string) => void;
  onSearchChange: (value: string) => void;
  onImportDomain: (domain: string) => void;
  onRemoveDomain: (domain: string) => void;
}

export function useBrowserCookieManager({
  enabled,
  activeUrl,
}: UseBrowserCookieManagerOptions): BrowserCookieManagerState {
  const [availableSources, setAvailableSources] = useState<BrowserCookieSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<BrowserCookieProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceDomains, setSourceDomains] = useState<BrowserCookieDomain[]>([]);
  const [sessionCookies, setSessionCookies] = useState<BrowserSessionCookie[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isLoadingDomains, setIsLoadingDomains] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const autoSeededSearchRef = useRef(false);

  const isAvailable = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return getDesktopBridgeCookieApi() !== null;
  }, []);

  const refreshSessionCookies = useCallback(async () => {
    const bridge = getDesktopBridgeCookieApi();
    if (!bridge) {
      setSessionCookies([]);
      return;
    }
    setSessionCookies(await bridge.browserListSessionCookies());
  }, []);

  useEffect(() => {
    if (!enabled || !isAvailable) {
      return;
    }

    const initialSearch = deriveInitialSearchFromUrl(activeUrl);
    if (!autoSeededSearchRef.current && initialSearch.length > 0) {
      autoSeededSearchRef.current = true;
      setSourceSearch(initialSearch);
    }

    let cancelled = false;
    setIsLoadingSources(true);

    void (async () => {
      try {
        const bridge = getDesktopBridgeCookieApi();
        if (!bridge) {
          return;
        }

        const [sources, cookies] = await Promise.all([
          bridge.browserListCookieSources(),
          bridge.browserListSessionCookies(),
        ]);
        if (cancelled) {
          return;
        }
        setAvailableSources(sources);
        setSessionCookies(cookies);
        setSelectedSourceId((current) =>
          current && sources.some((source) => source.id === current)
            ? current
            : (sources[0]?.id ?? null),
        );
      } finally {
        if (!cancelled) {
          setIsLoadingSources(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeUrl, enabled, isAvailable]);

  useEffect(() => {
    if (!enabled || !isAvailable || !selectedSourceId) {
      setAvailableProfiles([]);
      setSelectedProfileId(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      const bridge = getDesktopBridgeCookieApi();
      if (!bridge) {
        return;
      }

      const profiles = await bridge.browserListCookieProfiles(selectedSourceId);
      if (cancelled) {
        return;
      }
      setAvailableProfiles(profiles);
      setSelectedProfileId((current) =>
        current && profiles.some((profile) => profile.id === current)
          ? current
          : (profiles[0]?.id ?? null),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, isAvailable, selectedSourceId]);

  useEffect(() => {
    if (!enabled || !isAvailable || !selectedSourceId || !selectedProfileId) {
      setSourceDomains([]);
      return;
    }

    let cancelled = false;
    setIsLoadingDomains(true);

    void (async () => {
      try {
        const bridge = getDesktopBridgeCookieApi();
        if (!bridge) {
          return;
        }
        const domains = await bridge.browserListCookieDomains({
          sourceId: selectedSourceId,
          profileId: selectedProfileId,
          search: sourceSearch,
        });
        if (!cancelled) {
          setSourceDomains(domains);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDomains(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, isAvailable, selectedProfileId, selectedSourceId, sourceSearch]);

  const onImportDomain = useCallback(
    (domain: string) => {
      if (!selectedSourceId || !selectedProfileId) {
        return;
      }

      const bridge = getDesktopBridgeCookieApi();
      if (!bridge) {
        return;
      }

      setIsImporting(true);
      void bridge
        .browserImportCookies({
          sourceId: selectedSourceId,
          profileId: selectedProfileId,
          domains: [domain],
        })
        .then(() => refreshSessionCookies())
        .finally(() => {
          setIsImporting(false);
        });
    },
    [refreshSessionCookies, selectedProfileId, selectedSourceId],
  );

  const onRemoveDomain = useCallback(
    (domain: string) => {
      const bridge = getDesktopBridgeCookieApi();
      if (!bridge) {
        return;
      }

      setIsRemoving(true);
      void bridge
        .browserRemoveCookieDomain(domain)
        .then(() => refreshSessionCookies())
        .finally(() => {
          setIsRemoving(false);
        });
    },
    [refreshSessionCookies],
  );

  return {
    isAvailable,
    availableSources,
    selectedSourceId,
    availableProfiles,
    selectedProfileId,
    sourceSearch,
    sourceDomains,
    sessionCookies,
    isLoadingSources,
    isLoadingDomains,
    isImporting,
    isRemoving,
    onSourceChange: setSelectedSourceId,
    onProfileChange: setSelectedProfileId,
    onSearchChange: setSourceSearch,
    onImportDomain,
    onRemoveDomain,
  };
}
