"use client";

import { SearchIcon, Trash2Icon } from "lucide-react";
import type {
  BrowserCookieDomain,
  BrowserCookieProfile,
  BrowserCookieSource,
  BrowserSessionCookie,
} from "@t3tools/contracts";

import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface BrowserCookieManagerProps {
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

function groupCookiesByDomain(sessionCookies: BrowserSessionCookie[]) {
  const grouped = new Map<string, BrowserSessionCookie[]>();
  for (const cookie of sessionCookies) {
    const existing = grouped.get(cookie.domain);
    if (existing) {
      existing.push(cookie);
    } else {
      grouped.set(cookie.domain, [cookie]);
    }
  }
  return [...grouped.entries()].map(([domain, cookies]) => ({
    domain,
    cookies,
  }));
}

export default function BrowserCookieManager({
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
  onSourceChange,
  onProfileChange,
  onSearchChange,
  onImportDomain,
  onRemoveDomain,
}: BrowserCookieManagerProps) {
  const groupedSessionCookies = groupCookiesByDomain(sessionCookies);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="space-y-2">
        <h2 className="font-heading text-lg font-semibold text-foreground">Manage cookies</h2>
        <p className="text-sm text-muted-foreground">
          Import cookies from a local Chromium profile by domain, then remove them from the in-app
          browser when you no longer want them available.
        </p>
      </header>

      <section className="grid gap-3 rounded-2xl border border-border/70 bg-card/70 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Browser</span>
            <select
              aria-label="Cookie source browser"
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              disabled={isLoadingSources || availableSources.length === 0}
              value={selectedSourceId ?? ""}
              onChange={(event) => {
                onSourceChange(event.target.value);
              }}
            >
              <option value="" disabled>
                {availableSources.length === 0 ? "No browsers found" : "Choose a browser"}
              </option>
              {availableSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Profile</span>
            <select
              aria-label="Cookie source profile"
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              disabled={!selectedSourceId || availableProfiles.length === 0}
              value={selectedProfileId ?? ""}
              onChange={(event) => {
                onProfileChange(event.target.value);
              }}
            >
              <option value="" disabled>
                {availableProfiles.length === 0 ? "No profiles found" : "Choose a profile"}
              </option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-foreground">Source domains</span>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search source domains"
              className="pl-9"
              value={sourceSearch}
              onChange={(event) => {
                onSearchChange(event.target.value);
              }}
              placeholder="Search domains"
            />
          </div>
        </label>

        <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
          {isLoadingDomains ? (
            <p className="text-sm text-muted-foreground">Loading domains…</p>
          ) : sourceDomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {selectedSourceId ? "No domains matched this profile." : "Choose a browser first."}
            </p>
          ) : (
            sourceDomains.map((domain) => (
              <div
                key={domain.domain}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-foreground">{domain.domain}</div>
                  <div className="text-xs text-muted-foreground">
                    {domain.count} cookie{domain.count === 1 ? "" : "s"}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={isImporting}
                  aria-label={`Import cookies for ${domain.domain}`}
                  onClick={() => {
                    onImportDomain(domain.domain);
                  }}
                >
                  Import
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="grid min-h-0 gap-3 rounded-2xl border border-border/70 bg-card/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-medium text-foreground">In-app browser cookies</h3>
            <p className="text-sm text-muted-foreground">
              Current cookies stored in the Electron browser session.
            </p>
          </div>
          <Badge variant="outline">{sessionCookies.length}</Badge>
        </div>

        <div className="grid max-h-72 gap-3 overflow-y-auto pr-1">
          {groupedSessionCookies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cookies imported yet.</p>
          ) : (
            groupedSessionCookies.map((group) => (
              <div
                key={group.domain}
                className="rounded-xl border border-border/60 bg-background/70 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm text-foreground">{group.domain}</div>
                    <div className="text-xs text-muted-foreground">
                      {group.cookies.length} cookie{group.cookies.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isRemoving}
                    aria-label={`Remove imported cookies for ${group.domain}`}
                    onClick={() => {
                      onRemoveDomain(group.domain);
                    }}
                  >
                    <Trash2Icon className="size-4" />
                    Remove
                  </Button>
                </div>

                <div className="grid gap-2">
                  {group.cookies.map((cookie) => (
                    <div
                      key={`${cookie.domain}:${cookie.name}:${cookie.path}`}
                      className={cn(
                        "grid gap-1 rounded-lg border border-border/50 bg-muted/35 px-3 py-2 text-xs text-muted-foreground",
                      )}
                    >
                      <div className="font-mono text-sm text-foreground">{cookie.name}</div>
                      <div>
                        {cookie.path} · {cookie.expirationLabel}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge size="sm" variant="outline">
                          {cookie.sameSite}
                        </Badge>
                        {cookie.secure ? (
                          <Badge size="sm" variant="secondary">
                            Secure
                          </Badge>
                        ) : null}
                        {cookie.httpOnly ? (
                          <Badge size="sm" variant="secondary">
                            HttpOnly
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
